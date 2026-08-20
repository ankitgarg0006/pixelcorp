// Provider adapters. Everything speaks one shape:
//   callLLM(provider, {system, messages, tools}) -> {text, toolCalls:[{id,name,args}]}
// messages: [{role:'user'|'assistant', content:string}] plus tool exchange handled per-provider.
// provider:
//   {type:'anthropic', model, apiKeyEnv?}                       — Anthropic API (needs key)
//   {type:'openai', model, baseURL?, apiKeyEnv?}                — OpenAI-compatible (OpenAI, DeepSeek, Ollama…)
//   {type:'cli', tool:'claude'|'copilot', model?, command?[]}   — NO KEY: uses your Claude Code /
//                                                                 Copilot CLI sign-in (subscription)
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
const pexec = promisify(execFile);

// Detect whether a CLI engine is installed (and, best-effort, signed in) so the
// UI can show a green/amber/red status and an install command when it's missing.
export async function detectCLI(tool) {
  const bin = tool === 'copilot' ? 'copilot' : 'claude';
  const installCmd = bin === 'copilot'
    ? 'npm i -g @github/copilot'
    : 'npm i -g @anthropic-ai/claude-code';
  let installed = false, version = '', signedIn = null;
  try {
    const { stdout } = await pexec(bin, ['--version'], { timeout: 6000 });
    installed = true;
    version = (stdout || '').trim().split('\n')[0].slice(0, 60);
  } catch { installed = false; }
  if (installed) {
    try {
      const home = os.homedir();
      const any = (...ps) => ps.some(p => { try { return fs.existsSync(p); } catch { return false; } });
      signedIn = bin === 'claude'
        ? any(path.join(home, '.claude', '.credentials.json'), path.join(home, '.claude.json'))
        : any(path.join(home, '.copilot'), path.join(home, '.config', 'github-copilot'),
              path.join(home, '.config', 'gh', 'hosts.yml'));
    } catch { signedIn = null; }
  }
  return { tool: bin, installed, version, signedIn, installCmd,
    signinCmd: bin === 'copilot' ? 'copilot' : 'claude' };
}

// MCP servers already configured in the CLI itself (`claude mcp add` etc.).
// These are inherited by every employee on that engine (we pass --mcp-config
// additively, without --strict-mcp-config), so the UI shows them per employee.
export async function listCliMcp(tool) {
  const bin = tool === 'copilot' ? 'copilot' : 'claude';
  try {
    const { stdout } = await pexec(bin, ['mcp', 'list'], { timeout: 9000 });
    const servers = [];
    for (const line of (stdout || '').split('\n')) {
      const m = line.match(/^([A-Za-z0-9_.\-]+):\s+(.*)$/);
      if (!m) continue;                         // skips health-check / "No servers" lines
      const desc = m[2].replace(/\s+-\s+[✓✗●✔✘].*$/u, '').trim();
      servers.push({ name: m[1], desc });
    }
    return { tool: bin, servers };
  } catch (e) { return { tool: bin, servers: [], error: e.message }; }
}

function keyFor(provider) {
  if (provider.apiKeyEnv) return process.env[provider.apiKeyEnv] || '';
  if (provider.type === 'anthropic') return process.env.ANTHROPIC_API_KEY || '';
  return process.env.OPENAI_API_KEY || '';
}

export async function callLLM(provider, { system, messages, tools, fsAccess }) {
  if (provider.type === 'anthropic') return callAnthropic(provider, { system, messages, tools });
  if (provider.type === 'cli') return callCLI(provider, { system, messages, tools, fsAccess });
  return callOpenAI(provider, { system, messages, tools });
}

// ---------- Anthropic Messages API ----------
async function callAnthropic(provider, { system, messages, tools }) {
  const key = keyFor(provider);
  if (!key) throw new Error('No API key: set ANTHROPIC_API_KEY (or provider.apiKeyEnv).');
  const body = {
    model: provider.model || 'claude-sonnet-5',
    max_tokens: 1024,
    system,
    messages,
  };
  if (tools?.length) {
    body.tools = tools.map(t => ({
      name: t.name, description: t.description, input_schema: t.parameters,
    }));
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  let text = '';
  const toolCalls = [];
  for (const block of data.content || []) {
    if (block.type === 'text') text += block.text;
    if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, args: block.input });
  }
  return { text: text.trim(), toolCalls, raw: data };
}

export function anthropicToolResultTurn(assistantRaw, results) {
  // Continue an Anthropic conversation after tool calls.
  return [
    { role: 'assistant', content: assistantRaw.content },
    { role: 'user', content: results.map(r => ({
        type: 'tool_result', tool_use_id: r.id, content: r.content })) },
  ];
}

// ---------- OpenAI-compatible (OpenAI, DeepSeek, Gemini-compat, Ollama, Groq…) ----------
async function callOpenAI(provider, { system, messages, tools }) {
  const baseURL = (provider.baseURL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const key = keyFor(provider);
  const isLocal = baseURL.includes('localhost') || baseURL.includes('127.0.0.1');
  if (!key && !isLocal) throw new Error('No API key: set OPENAI_API_KEY (or provider.apiKeyEnv).');
  const body = {
    model: provider.model,
    messages: [{ role: 'system', content: system }, ...messages],
  };
  if (tools?.length) {
    body.tools = tools.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${baseURL} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const choice = data.choices?.[0]?.message || {};
  const toolCalls = (choice.tool_calls || []).map(tc => ({
    id: tc.id, name: tc.function.name,
    args: safeJSON(tc.function.arguments),
  }));
  return { text: (choice.content || '').trim(), toolCalls, raw: choice };
}

export function openaiToolResultTurn(assistantRaw, results) {
  return [
    assistantRaw,
    ...results.map(r => ({ role: 'tool', tool_call_id: r.id, content: r.content })),
  ];
}

function safeJSON(s) { try { return JSON.parse(s); } catch { return {}; } }

// ---------- CLI engines (no API key — uses the CLI's own sign-in) ----------
// claude:  Claude Code CLI, billed to your Claude subscription (run `claude` once to log in)
// copilot: GitHub Copilot CLI, billed to your Copilot plan (run `copilot` once to log in)
// The CLI is one-shot text, so delegation uses a JSON protocol instead of native tools.
function cliCommand(provider) {
  if (provider.command?.length) return provider.command;
  if (provider.tool === 'copilot') {
    // NB: the prompt is appended inline as `-p <prompt>` in callCLI (the Copilot
    // CLI requires it as the flag's value, unlike claude which reads stdin), so
    // -p is intentionally NOT added here — keep --model etc. before it.
    const cmd = ['copilot'];
    if (provider.model && provider.model !== 'default') cmd.push('--model', provider.model);
    return cmd;
  }
  const cmd = ['claude', '-p', '--output-format', 'text'];
  if (provider.model) cmd.push('--model', provider.model);
  return cmd;
}

function buildCLIPrompt(system, messages, tools) {
  // The whole exchange is one flat text blob, so label the system brief as
  // background and put the actual instruction LAST — otherwise small models
  // sometimes answer the persona/roster text instead of the final turn.
  const parts = [
    'CONTEXT — who you are (background only; never answer, summarize or introduce this section):',
    system,
  ];
  if (tools?.length) {
    parts.push(
      '\nDELEGATION PROTOCOL: if (and only if) you want to delegate, reply with NOTHING but this JSON:',
      '{"delegate":[{"to":"<employee id>","task":"<clear subtask>"}]}',
      'Otherwise reply with your normal message (never mention this protocol).');
  }
  parts.push('\n--- Conversation so far ---');
  for (const m of messages) {
    const content = typeof m.content === 'string' ? m.content
      : (Array.isArray(m.content) ? m.content.map(c => c.text || '').join(' ') : '');
    parts.push(`${m.role === 'assistant' ? 'You' : 'Them'}: ${content}`);
  }
  parts.push(
    '--- End of conversation ---',
    'YOUR TASK: answer the LAST "Them" message above, and nothing else'
      + (tools?.length ? ' (plain text, or the delegation JSON).' : ' (plain text).')
      + ' Address its content directly; do not introduce yourself or describe how you operate.');
  return parts.join('\n');
}

function extractDelegations(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]);
    if (!obj.delegate) return null;
    const arr = Array.isArray(obj.delegate) ? obj.delegate : [obj.delegate];
    const valid = arr.filter(d => d && d.to && d.task);
    return valid.length ? valid : null;
  } catch { return null; }
}

async function callCLI(provider, { system, messages, tools, fsAccess }) {
  const custom = provider.command?.length;
  const [bin, ...args] = cliCommand(provider);
  // Charter scoping: the employee's first repo becomes the CLI's working
  // directory; the rest are granted with --add-dir. No charter = no file access.
  let cwd;
  if (fsAccess?.dirs?.length) {
    cwd = fsAccess.dirs[0];
    if (bin === 'claude') {
      for (const d of fsAccess.dirs.slice(1)) args.push('--add-dir', d);
      if (fsAccess.allowedTools) args.push('--allowedTools', fsAccess.allowedTools);
    } else if (bin === 'copilot' && !custom) {
      for (const d of fsAccess.dirs.slice(1)) args.push('--add-dir', d);
    }
  }
  // Login method — how this employee authenticates (lets you run different
  // employees on different members' accounts/credits):
  //   'machine' (default) : this box's single CLI sign-in
  //   'dir'               : a separate CLI credential dir (another member's sign-in)
  //   'apikey'            : a per-employee API key / token
  const childEnv = { ...process.env };
  const login = provider.login || 'machine';
  const apiKey = provider.apiKey || (provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : '');
  if (login === 'dir' && provider.authDir) {
    if (bin === 'claude') childEnv.CLAUDE_CONFIG_DIR = provider.authDir;
    else childEnv.XDG_CONFIG_HOME = provider.authDir; // copilot reads config under XDG
  } else if (login === 'apikey' && apiKey) {
    if (bin === 'claude') childEnv.ANTHROPIC_API_KEY = apiKey;
    else { childEnv.GH_TOKEN = apiKey; childEnv.GITHUB_TOKEN = apiKey; }
  }

  // Per-employee MCP servers → a generated --mcp-config file (CLI engines only).
  let mcpFile = null;
  const mcpList = Array.isArray(provider.mcpServers) ? provider.mcpServers.filter(s => s && s.name) : [];
  if (mcpList.length) {
    const mcpServers = {};
    for (const s of mcpList) {
      mcpServers[s.name] = s.url
        ? { url: s.url }
        : { command: s.command, ...(s.args?.length ? { args: s.args } : {}), ...(s.env ? { env: s.env } : {}) };
    }
    mcpFile = path.join(os.tmpdir(), `pixelcorp-mcp-${process.pid}-${Date.now()}.json`);
    try { fs.writeFileSync(mcpFile, JSON.stringify({ mcpServers }, null, 2)); args.push('--mcp-config', mcpFile); }
    catch { mcpFile = null; }
  }

  const prompt = buildCLIPrompt(system, messages, tools);
  // Feed the prompt: Claude Code reads it from stdin; the GitHub Copilot CLI
  // requires it inline as the value of -p/--prompt (an empty -p throws
  // "option '-p, --prompt <prompt>' argument missing"). Copilot also needs
  // --allow-all-tools to run non-interactively without a TTY approval prompt.
  let stdinPrompt = prompt;
  if (bin === 'copilot' && !custom) {
    args.push('--allow-all-tools', '-p', prompt);
    stdinPrompt = null;
  }
  const stdout = await new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], cwd, env: childEnv });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${bin} timed out after 180s`)); }, 180_000);
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('error', e => { clearTimeout(timer);
      reject(new Error(e.code === 'ENOENT'
        ? `"${bin}" CLI not found — install it and sign in once (${bin === 'claude' ? 'Claude Code: npm i -g @anthropic-ai/claude-code, then run claude' : 'Copilot CLI: npm i -g @github/copilot, then run copilot'}).`
        : e.message)); });
    child.on('close', code => { clearTimeout(timer);
      if (mcpFile) { try { fs.unlinkSync(mcpFile); } catch { /* ignore */ } }
      if (code === 0) resolve(out);
      else reject(new Error(`${bin} exited ${code}: ${(err || out).slice(0, 300)}`)); });
    if (stdinPrompt != null) child.stdin.end(stdinPrompt); else child.stdin.end();
  });
  const text = stdout.trim();
  if (tools?.length) {
    const del = extractDelegations(text);
    if (del) return {
      text: '',
      toolCalls: del.map((d, i) => ({ id: `cli_${i}`, name: 'delegate', args: d })),
      raw: { cliText: text },
    };
  }
  return { text, toolCalls: [], raw: { cliText: text } };
}

export function cliToolResultTurn(assistantRaw, results) {
  return [
    { role: 'assistant', content: assistantRaw.cliText },
    { role: 'user', content:
      'Delegation results:\n' + results.map(r => r.content).join('\n---\n') +
      '\nNow give your final reply to the requester (plain text).' },
  ];
}
