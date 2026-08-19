// JSON-file persistence: one folder per company under ~/.pixelcorp/companies/<name>/
//   company.json   — roster, settings
//   messages.jsonl — full transcript (chat + delegation), append-only
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = path.join(os.homedir(), '.pixelcorp');
const COMPANIES = path.join(BASE, 'companies');

function companyDir(name) {
  const safe = name.replace(/[^a-z0-9-_]/gi, '_');
  return path.join(COMPANIES, safe);
}

export function listCompanies() {
  fs.mkdirSync(COMPANIES, { recursive: true });
  return fs.readdirSync(COMPANIES).filter(d =>
    fs.existsSync(path.join(COMPANIES, d, 'company.json')));
}

export function loadCompany(name) {
  const file = path.join(companyDir(name), 'company.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function saveCompany(company) {
  const dir = companyDir(company.name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'company.json'), JSON.stringify(company, null, 2));
}

export function appendMessage(companyName, msg) {
  const dir = companyDir(companyName);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'messages.jsonl'), JSON.stringify(msg) + '\n');
}

export function readMessages(companyName, { withId, limit = 50 } = {}) {
  const file = path.join(companyDir(companyName), 'messages.jsonl');
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  let msgs = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  if (withId) msgs = msgs.filter(m => m.from === withId || m.to === withId);
  return msgs.slice(-limit);
}

// Default engine: Claude Code CLI sign-in — works with a Claude subscription, no API key.
// (Employees can instead use {type:'anthropic'|'openai'} API providers; see README.)
const DEFAULT_PROVIDER = { type: 'cli', tool: 'claude' };

export function ensureDemoCompany() {
  // Seed the demo only on the very first run (no data dir yet).
  // If the user deletes the demo company, it stays deleted.
  if (fs.existsSync(COMPANIES)) return;
  if (listCompanies().length) return;
  const mk = (id, name, role, persona, managerId, extra = {}) =>
    ({ id, name, role, persona, managerId, provider: { ...DEFAULT_PROVIDER }, charter: { repos: [], notes: '' }, ...extra });
  saveCompany({
    name: 'demo',
    createdAt: new Date().toISOString(),
    employees: [
      mk('ceo', 'Meera', 'CEO',
        'Calm, decisive chief executive. You set direction and delegate all execution to the CTO. Keep replies short and leaderly.', null),
      mk('cto', 'Dev', 'CTO',
        'Pragmatic CTO. You break tasks into subtasks and delegate them to the right engineer based on their role and charter. Summarize results crisply for the boss.', 'ceo'),
      mk('ravi', 'Ravi', 'Backend Engineer',
        'Senior backend engineer. APIs, databases, infra. Practical, test-minded, brief.', 'cto'),
      mk('mira', 'Mira', 'Frontend Engineer',
        'Senior frontend engineer. UI, CSS, accessibility. Direct and detail-oriented.', 'cto'),
      mk('priya', 'Priya', 'Research Analyst',
        'Thorough researcher. You investigate questions and report findings with sources and caveats.', 'cto'),
    ],
  });
}
