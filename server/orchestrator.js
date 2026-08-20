// The company brain: routes messages to employee agents, executes delegation,
// persists the transcript, and broadcasts events for the office UI to animate.
import fs from 'node:fs';
import os from 'node:os';
import { appendMessage, readMessages, appendTrace } from './store.js';
import { callLLM, anthropicToolResultTurn, openaiToolResultTurn, cliToolResultTurn } from './providers.js';

// Charter → file access for CLI engines. An employee may ONLY touch the repos
// listed in their charter; charter.permissions maps to Claude Code tool allowlists.
const PERM_TOOLS = { read: 'Read Grep Glob LS', write: 'Edit Write MultiEdit', run: 'Bash' };
function fsAccessFor(emp) {
  const dirs = (emp.charter?.repos || [])
    .map(p => p.replace(/^~(?=$|\/)/, os.homedir()))
    .filter(p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
  if (!dirs.length) return null;
  const perms = emp.charter?.permissions?.length ? emp.charter.permissions : ['read'];
  const allowedTools = perms.map(p => PERM_TOOLS[p] || '').filter(Boolean).join(' ');
  return { dirs, allowedTools };
}

const MAX_DEPTH = 2;     // delegation chain limit
const MAX_STEPS = 5;     // tool-use rounds per agent turn

export function makeOrchestrator(company, broadcast) {
  const pending = new Map(); // empId -> count of queued + running turns
  const queues = new Map();  // empId -> promise tail, so each employee runs one turn at a time
  const approvals = new Map(); // approvalId -> resolver
  let approvalSeq = 0;

  // Delegations pause here until the Boss approves them in the UI.
  // Set PIXELCORP_AUTO_APPROVE=1 to skip the gate. 5-minute timeout = declined.
  function requestApproval(fromId, toId, task) {
    if (process.env.PIXELCORP_AUTO_APPROVE === '1') return Promise.resolve(true);
    const id = `ap${++approvalSeq}_${Date.now()}`;
    broadcast({ type: 'approval', company: company().name, id,
      from: fromId, fromName: employee(fromId)?.name,
      to: toId, toName: employee(toId)?.name, task });
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        approvals.delete(id);
        broadcast({ type: 'approval-resolved', company: company().name, id, approved: false, reason: 'timeout' });
        resolve(false);
      }, 5 * 60 * 1000);
      approvals.set(id, ok => {
        clearTimeout(timer);
        approvals.delete(id);
        broadcast({ type: 'approval-resolved', company: company().name, id, approved: ok });
        resolve(ok);
      });
    });
  }

  function employee(id) { return company().employees.find(e => e.id === id); }

  function rosterText() {
    return company().employees.map(e =>
      `- ${e.name} (id: ${e.id}) — ${e.role}${e.managerId ? `, reports to ${e.managerId}` : ''}` +
      (e.charter?.repos?.length ? ` — owns: ${e.charter.repos.join(', ')}` : '')
    ).join('\n');
  }

  function systemPrompt(emp, canDelegate) {
    const reports = company().employees.filter(e => e.managerId === emp.id);
    return [
      `You are ${emp.name}, ${emp.role} at "${company().name}", a small company run by the Boss (the human user).`,
      emp.persona,
      emp.charter?.notes ? `Your charter: ${emp.charter.notes}` : '',
      emp.charter?.repos?.length
        ? `You own these repos and (on the CLI engine) have file-tool access to them and NOTHING else: ${emp.charter.repos.join(', ')}`
        : `You have NO file access — no repos are in your charter. If the Boss asks you to inspect or change code, don't try; explain that they should assign the repo to your charter (Hire form or ~/.pixelcorp company.json) and you'll take it from there.`,
      `\nCompany roster:\n${rosterText()}`,
      canDelegate && reports.length
        ? `\nYou may delegate subtasks to your direct reports (${reports.map(r => r.id).join(', ')}) using the "delegate" tool. Delegate when a task belongs to someone else's specialty; do the thinking yourself. After delegating, synthesize the results into one crisp reply.`
        : `\nHandle the request yourself; you cannot delegate.`,
      `Keep replies concise and conversational — you are chatting in an office, not writing essays.`,
    ].filter(Boolean).join('\n');
  }

  function historyFor(empId, limit = 20) {
    const msgs = readMessages(company().name, { withId: empId, limit })
      .map(m => ({
        role: m.from === empId ? 'assistant' : 'user',
        content: m.from === empId ? m.text : `${m.fromName || m.from}: ${m.text}`,
      }))
      .filter(m => m.content);
    // Anthropic rejects conversations that start with an assistant turn.
    while (msgs.length && msgs[0].role === 'assistant') msgs.shift();
    return msgs;
  }

  function record(msg) {
    const full = { ...msg, at: new Date().toISOString() };
    appendMessage(company().name, full);
    broadcast({ type: 'chat', company: company().name, ...full });
    return full;
  }

  // live work-log line for the office UI (not persisted)
  function progress(empId, text) {
    broadcast({ type: 'progress', company: company().name, id: empId, text, at: new Date().toISOString() });
  }
  // ephemeral tool-call / delegation event — shown transiently in the chat's work
  // rail, NOT written to the transcript (only real chat messages are persisted)
  function worklog(msg) {
    broadcast({ type: 'worklog', company: company().name, ...msg, at: new Date().toISOString() });
  }
  // raw engine trace for the opt-in Terminal tab (command + raw output + notes)
  // — broadcast live AND persisted to trace.jsonl so it survives a reload.
  function terminal(empId, payload) {
    const at = new Date().toISOString();
    broadcast({ type: 'terminal', company: company().name, id: empId, ...payload, at });
    try { appendTrace(company().name, { id: empId, cmd: payload.cmd, note: payload.note, level: payload.level, output: payload.output, at }); }
    catch { /* ignore */ }
  }

  // Run one employee's agent turn on an incoming message. Returns reply text.
  // Turns for the same employee are queued so they never interleave.
  function runAgent(empId, fromId, fromName, text, depth = 0, incoming = null) {
    pending.set(empId, (pending.get(empId) || 0) + 1);
    const prev = queues.get(empId) || Promise.resolve();
    const turn = prev.then(() => runTurn(empId, fromId, fromName, text, depth, incoming));
    queues.set(empId, turn.catch(() => {}));
    return turn;
  }

  async function runTurn(empId, fromId, fromName, text, depth, incoming) {
    try {
      const emp = employee(empId);
      if (!emp) throw new Error(`No employee "${empId}"`);
      broadcast({ type: 'status', company: company().name, id: empId, status: 'working' });
      progress(empId, depth ? `picked up a task from ${fromName}` : `reading the Boss's message`);
      const canDelegate = depth < MAX_DEPTH &&
        company().employees.some(e => e.managerId === empId);
      const tools = canDelegate ? [{
        name: 'delegate',
        description: 'Hand a subtask to one of your direct reports and get their result back.',
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'employee id of the direct report' },
            task: { type: 'string', description: 'clear, self-contained subtask description' },
          },
          required: ['to', 'task'],
        },
      }] : [];

      // Snapshot history BEFORE recording the incoming message, so the model
      // does not see the same prompt twice (once in history, once appended).
      let messages = [...historyFor(empId), { role: 'user', content: `${fromName}: ${text}` }];
      // Persist only real chat (the Boss's message); a delegated sub-task is a
      // tool call — surface it transiently, don't write it to the transcript.
      if (incoming) { if (incoming.kind === 'chat') record(incoming); else worklog(incoming); }
      const system = systemPrompt(emp, canDelegate);

      const fsAccess = fsAccessFor(emp);
      for (let step = 0; step < MAX_STEPS; step++) {
        progress(empId, step === 0 ? 'thinking…' : 'synthesizing results…');
        const out = await callLLM(emp.provider, { system, messages, tools, fsAccess,
          onTerminal: payload => terminal(empId, payload) });   // live trace → Terminal tab
        if (!out.toolCalls.length) return out.text || '…';

        // execute delegations sequentially so the office animates naturally
        const results = [];
        for (const call of out.toolCalls) {
          if (call.name !== 'delegate') {
            results.push({ id: call.id, content: 'Unknown tool.' });
            continue;
          }
          const target = employee(call.args.to);
          if (!target || target.managerId !== empId) {
            results.push({ id: call.id, content: `You cannot delegate to "${call.args.to}".` });
            continue;
          }
          progress(empId, `asking the Boss to approve delegating to ${target.name}…`);
          const approved = await requestApproval(empId, target.id, call.args.task);
          if (!approved) {
            worklog({ from: empId, fromName: emp.name, to: target.id, kind: 'delegation',
              text: `✕ Boss declined: "${call.args.task}"` });
            terminal(empId, { note: `✕ Boss declined delegation to ${target.name}`, level: 'no' });
            results.push({ id: call.id,
              content: 'The Boss DECLINED this delegation. Do not retry it; handle it yourself or explain what you need.' });
            continue;
          }
          broadcast({ type: 'delegate', company: company().name, from: empId, to: target.id, task: call.args.task });
          terminal(empId, { note: `↳ delegate → ${target.name} · "${call.args.task}"` });
          progress(empId, `waiting on ${target.name}…`);
          const sub = await runAgent(target.id, empId, emp.name, call.args.task, depth + 1,
            { from: empId, fromName: emp.name, to: target.id, kind: 'delegation', text: `→ ${target.name}: ${call.args.task}` });
          worklog({ from: target.id, fromName: target.name, to: empId, kind: 'delegation-result', text: sub });
          terminal(empId, { note: `← ${target.name} replied ✓`, level: 'ok', output: sub });
          progress(empId, `heard back from ${target.name} ✓`);
          results.push({ id: call.id, content: sub });
        }
        if (emp.provider.type === 'anthropic')
          messages = [...messages, ...anthropicToolResultTurn(out.raw, results)];
        else if (emp.provider.type === 'cli')
          messages = [...messages, ...cliToolResultTurn(out.raw, results)];
        else
          messages = [...messages, ...openaiToolResultTurn(out.raw, results)];
      }
      return 'I ran out of delegation rounds — here is where things stand: see the activity feed.';
    } finally {
      const left = (pending.get(empId) || 1) - 1;
      if (left > 0) {
        pending.set(empId, left);
      } else {
        pending.delete(empId);
        broadcast({ type: 'status', company: company().name, id: empId, status: 'idle' });
      }
    }
  }

  return {
    // Boss (user) sends a message to an employee.
    async messageEmployee(empId, text) {
      const emp = employee(empId);
      if (!emp) throw new Error(`No employee "${empId}"`);
      try {
        const reply = await runAgent(empId, 'boss', 'Boss', text, 0,
          { from: 'boss', fromName: 'Boss', to: empId, kind: 'chat', text });
        record({ from: empId, fromName: emp.name, to: 'boss', kind: 'chat', text: reply });
        return reply;
      } catch (err) {
        const msg = `⚠️ ${err.message}`;
        record({ from: empId, fromName: emp.name, to: 'boss', kind: 'error', text: msg });
        return msg;
      }
    },
    isBusy: id => pending.has(id),
    resolveApproval(id, ok) {
      const fn = approvals.get(id);
      if (!fn) return false;
      fn(!!ok);
      return true;
    },
  };
}
