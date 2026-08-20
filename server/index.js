import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  listCompanies, loadCompany, saveCompany, readMessages, ensureDemoCompany, deleteCompany,
} from './store.js';
import { makeOrchestrator } from './orchestrator.js';
import { detectCLI, listCliMcp } from './providers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(__dirname, '..', 'web');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

export function startServer(port = 4310) {
  ensureDemoCompany();

  const sockets = new Set();
  const broadcast = ev => {
    const s = JSON.stringify(ev);
    for (const ws of sockets) if (ws.readyState === 1) ws.send(s);
  };

  // orchestrators per company, lazily created; company() re-reads so hires apply live
  const orchestrators = new Map();
  function orch(name) {
    if (!orchestrators.has(name))
      orchestrators.set(name, makeOrchestrator(() => loadCompany(name), broadcast));
    return orchestrators.get(name);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const send = (code, data, type = 'application/json') => {
      res.writeHead(code, { 'content-type': type });
      res.end(type === 'application/json' ? JSON.stringify(data) : data);
    };
    try {
      if (url.pathname === '/api/companies' && req.method === 'GET')
        return send(200, listCompanies());

      // is a CLI engine installed / signed in? (drives the install prompt in the UI)
      if (url.pathname === '/api/cli' && req.method === 'GET') {
        const tool = url.searchParams.get('tool') || 'claude';
        return send(200, await detectCLI(tool));
      }

      // MCP servers already configured in the CLI (inherited by every employee)
      if (url.pathname === '/api/mcp' && req.method === 'GET') {
        const tool = url.searchParams.get('tool') || 'claude';
        return send(200, await listCliMcp(tool));
      }

      // list models the user can actually use for a given engine
      if (url.pathname === '/api/models' && req.method === 'GET') {
        const type = url.searchParams.get('type') || '';
        try {
          if (type === 'cli-claude')
            // aliases + current full ids understood by `claude -p --model`
            return send(200, { models: [
              { id: 'default', label: 'default (Claude Code setting)' },
              { id: 'opus', label: 'opus (latest Opus)' },
              { id: 'sonnet', label: 'sonnet (latest Sonnet)' },
              { id: 'haiku', label: 'haiku (latest Haiku)' },
              { id: 'claude-opus-4-8', label: 'claude-opus-4-8' },
              { id: 'claude-sonnet-5', label: 'claude-sonnet-5' },
              { id: 'claude-sonnet-4-5', label: 'claude-sonnet-4-5' },
              { id: 'claude-haiku-4-5', label: 'claude-haiku-4-5' },
            ] });
          if (type === 'cli-copilot')
            // models selectable in the GitHub Copilot CLI (billed to your Copilot plan)
            return send(200, { models: [
              { id: 'default', label: 'default (Copilot setting)' },
              { id: 'claude-sonnet-4.5', label: 'claude-sonnet-4.5' },
              { id: 'claude-sonnet-4', label: 'claude-sonnet-4' },
              { id: 'gpt-5', label: 'gpt-5' },
              { id: 'gpt-5-mini', label: 'gpt-5-mini' },
              { id: 'o3', label: 'o3' },
              { id: 'o4-mini', label: 'o4-mini' },
              { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro' },
            ] });
          if (type === 'anthropic') {
            const key = process.env.ANTHROPIC_API_KEY;
            if (!key) return send(200, { models: [], error: 'set ANTHROPIC_API_KEY to list models' });
            const r = await fetch('https://api.anthropic.com/v1/models?limit=50', {
              headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } });
            if (!r.ok) return send(200, { models: [], error: `Anthropic ${r.status}` });
            const d = await r.json();
            return send(200, { models: (d.data || []).map(m => ({ id: m.id, label: m.display_name || m.id })) });
          }
          if (type === 'openai') {
            const baseURL = (url.searchParams.get('baseURL') || 'https://api.openai.com/v1').replace(/\/$/, '');
            const key = process.env.OPENAI_API_KEY;
            const isLocal = baseURL.includes('localhost') || baseURL.includes('127.0.0.1');
            if (!key && !isLocal) return send(200, { models: [], error: 'set OPENAI_API_KEY to list models' });
            const r = await fetch(baseURL + '/models', {
              headers: key ? { authorization: `Bearer ${key}` } : {} });
            if (!r.ok) return send(200, { models: [], error: `${baseURL} ${r.status}` });
            const d = await r.json();
            return send(200, { models: (d.data || []).map(m => ({ id: m.id })).slice(0, 100) });
          }
          return send(400, { error: 'unknown type' });
        } catch (err) {
          return send(200, { models: [], error: err.message });
        }
      }

      if (url.pathname === '/api/companies' && req.method === 'POST') {
        const body = await readBody(req);
        if (!body.name) return send(400, { error: 'name required' });
        if (loadCompany(body.name)) return send(409, { error: 'exists' });
        saveCompany({ name: body.name, createdAt: new Date().toISOString(), employees: [] });
        return send(200, { ok: true });
      }

      const m = url.pathname.match(/^\/api\/company\/([^/]+)(\/.*)?$/);
      if (m) {
        const name = decodeURIComponent(m[1]);
        const sub = m[2] || '';
        const company = loadCompany(name);
        if (!company) return send(404, { error: 'no such company' });

        if (sub === '' && req.method === 'GET') {
          const o = orch(name);
          return send(200, {
            ...company,
            employees: company.employees.map(e => ({ ...e, busy: o.isBusy(e.id) })),
          });
        }
        // Permanently delete a company (roster + transcript + folder).
        if (sub === '/delete' && req.method === 'POST') {
          orchestrators.delete(name);            // drop its live orchestrator
          const ok = deleteCompany(name);
          broadcast({ type: 'company-deleted', company: name });
          return send(200, { ok });
        }
        if (sub === '/history' && req.method === 'GET')
          return send(200, readMessages(name, {
            withId: url.searchParams.get('with') || undefined,
            limit: Number(url.searchParams.get('limit') || 60),
          }));

        if (sub === '/hire' && req.method === 'POST') {
          const b = await readBody(req);
          if (!b.name || !b.role) return send(400, { error: 'name and role required' });
          // re-load after the await so concurrent hires/fires are not overwritten
          const fresh = loadCompany(name);
          if (!fresh) return send(404, { error: 'no such company' });
          const id = (b.id || b.name).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || `emp${Date.now()}`;
          if (fresh.employees.some(e => e.id === id)) return send(409, { error: 'id taken' });
          fresh.employees.push({
            id, name: b.name, role: b.role,
            persona: b.persona || `You are a skilled ${b.role}. Be helpful, practical and concise.`,
            managerId: b.managerId || null,
            provider: b.provider || { type: 'cli', tool: 'claude' },
            charter: b.charter || { repos: [], notes: '' },
          });
          saveCompany(fresh);
          broadcast({ type: 'hired', company: name, id, name: b.name, role: b.role });
          return send(200, { ok: true, id });
        }

        if (sub === '/fire' && req.method === 'POST') {
          const b = await readBody(req);
          // re-load after the await so concurrent hires/fires are not overwritten
          const fresh = loadCompany(name);
          if (!fresh) return send(404, { error: 'no such company' });
          const idx = fresh.employees.findIndex(e => e.id === b.id);
          if (idx < 0) return send(404, { error: 'no such employee' });
          const [gone] = fresh.employees.splice(idx, 1);
          fresh.employees.forEach(e => { if (e.managerId === b.id) e.managerId = null; });
          saveCompany(fresh);
          broadcast({ type: 'fired', company: name, id: gone.id, name: gone.name });
          return send(200, { ok: true });
        }

        if (sub === '/message' && req.method === 'POST') {
          const b = await readBody(req);
          if (!b.to || !b.text) return send(400, { error: 'to and text required' });
          const fresh = loadCompany(name);
          if (!fresh || !fresh.employees.some(e => e.id === b.to))
            return send(404, { error: 'no such employee' });
          // async: reply arrives over the websocket; HTTP returns immediately
          orch(name).messageEmployee(b.to, b.text).catch(err =>
            broadcast({ type: 'chat', company: name, kind: 'error', from: b.to, to: 'boss', text: `⚠️ ${err.message}`, at: new Date().toISOString() }));
          return send(200, { ok: true });
        }

        if (sub === '/update' && req.method === 'POST') {
          const b = await readBody(req);
          const fresh = loadCompany(name);
          const emp = fresh?.employees.find(e => e.id === b.id);
          if (!emp) return send(404, { error: 'no such employee' });
          if (typeof b.role === 'string' && b.role.trim()) emp.role = b.role.trim();
          if (typeof b.persona === 'string' && b.persona.trim()) emp.persona = b.persona.trim();
          if ('managerId' in b) emp.managerId = b.managerId || null;
          if (b.provider && b.provider.type) emp.provider = b.provider;
          saveCompany(fresh);
          broadcast({ type: 'updated', company: name, id: emp.id });
          return send(200, { ok: true, employee: emp });
        }

        if (sub === '/charter' && req.method === 'POST') {
          const b = await readBody(req);
          const fresh = loadCompany(name);
          const emp = fresh?.employees.find(e => e.id === b.id);
          if (!emp) return send(404, { error: 'no such employee' });
          emp.charter = {
            repos: Array.isArray(b.repos) ? b.repos : emp.charter?.repos || [],
            permissions: Array.isArray(b.permissions) ? b.permissions : emp.charter?.permissions || ['read'],
            notes: typeof b.notes === 'string' ? b.notes : emp.charter?.notes || '',
          };
          saveCompany(fresh);
          broadcast({ type: 'charter', company: name, id: emp.id, charter: emp.charter });
          return send(200, { ok: true, charter: emp.charter });
        }

        if (sub === '/approve' && req.method === 'POST') {
          const b = await readBody(req);
          if (!b.id) return send(400, { error: 'id required' });
          const found = orch(name).resolveApproval(b.id, !!b.approve);
          return send(found ? 200 : 404, found ? { ok: true } : { error: 'no such pending approval' });
        }
      }

      // vendored libraries (served from node_modules, pinned via package.json)
      const VENDOR = {
        '/vendor/marked.js': path.join(__dirname, '..', 'node_modules', 'marked', 'lib', 'marked.umd.js'),
        '/vendor/purify.js': path.join(__dirname, '..', 'node_modules', 'dompurify', 'dist', 'purify.min.js'),
      };
      if (VENDOR[url.pathname] && fs.existsSync(VENDOR[url.pathname]))
        return send(200, fs.readFileSync(VENDOR[url.pathname]), 'text/javascript');

      // static files
      let file = url.pathname === '/' ? '/index.html' : url.pathname;
      const full = path.join(WEB, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
      if (full.startsWith(WEB) && fs.existsSync(full) && fs.statSync(full).isFile())
        return send(200, fs.readFileSync(full), MIME[path.extname(full)] || 'application/octet-stream');
      return send(404, { error: 'not found' });
    } catch (err) {
      return send(500, { error: err.message });
    }
  });

  const wss = new WebSocketServer({ server });
  wss.on('error', console.error);
  wss.on('connection', ws => {
    sockets.add(ws);
    ws.on('close', () => sockets.delete(ws));
    ws.on('error', () => ws.terminate());
  });

  return new Promise(resolve => server.listen(port, () => resolve(server)));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
