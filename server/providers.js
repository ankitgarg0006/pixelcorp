// Provider adapters. Everything speaks one shape:
//   callLLM(provider, {system, messages, tools}) -> {text, toolCalls:[{id,name,args}]}
// messages: [{role:'user'|'assistant', content:string}] plus tool exchange handled per-provider.
// provider:
//   {type:'anthropic', model, apiKeyEnv?}                       — Anthropic API (needs key)
//   {type:'openai', model, baseURL?, apiKeyEnv?}                — OpenAI-compatible (OpenAI, DeepSeek, Ollama…)
//   {type:'cli', tool:'claude'|'copilot', model?, command?[]}   — NO KEY: uses your Claude Code /
//                                                                 Copilot CLI sign-in (subscription)
import { spawn } from 'node:child_process';

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
    const cmd = ['copilot', '-p'];
    if (provider.model) cmd.push('--model', provider.model);
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
  const [bin, ...args] = cliCommand(provider);
  // Charter scoping: the employee's first repo becomes the CLI's working
  // directory; the rest are granted with --add-dir. No charter = no file access.
  let cwd;
  if (fsAccess?.dirs?.length) {
    cwd = fsAccess.dirs[0];
    if (bin === 'claude') {
      for (const d of fsAccess.dirs.slice(1)) args.push('--add-dir', d);
      if (fsAccess.allowedTools) args.push('--allowedTools', fsAccess.allowedTools);
    }
  }
  const prompt = buildCLIPrompt(system, messages, tools);
  const stdout = await new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], cwd });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${bin} timed out after 180s`)); }, 180_000);
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('error', e => { clearTimeout(timer);
      reject(new Error(e.code === 'ENOENT'
        ? `"${bin}" CLI not found — install it and sign in once (${bin === 'claude' ? 'Claude Code: npm i -g @anthropic-ai/claude-code, then run claude' : 'Copilot CLI: npm i -g @github/copilot, then run copilot'}).`
        : e.message)); });
    child.on('close', code => { clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${bin} exited ${code}: ${(err || out).slice(0, 300)}`)); });
    child.stdin.end(prompt);
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
