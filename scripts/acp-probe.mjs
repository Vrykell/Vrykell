/**
 * acp-probe — drive an ACP agent through a whole turn, outside the app.
 *
 * Spawns the given command and speaks the same newline-delimited JSON-RPC the app does:
 * `initialize` → `session/new` → `session/prompt`, printing every session update until the turn
 * stops. It answers a permission request by refusing it (pass --allow to take the first allow
 * option instead) and refuses the file-system and terminal methods, exactly like the app, which
 * declares neither capability.
 *
 * Use it when a harness misbehaves: if the probe fails the same way, the agent (or its login) is
 * the problem, not the app; if the probe succeeds, the app is where to look.
 *
 *   node scripts/acp-probe.mjs opencode acp
 *   node scripts/acp-probe.mjs --prompt "Reply with exactly: ok" npx -y @zed-industries/claude-code-acp
 *
 * Flags (before the command): --prompt <text> (default "Reply with exactly: ok"), --cwd <dir>
 * (default the current directory), --timeout <ms> (default 240000), --allow (accept permission
 * requests), --quiet (only the outcome).
 */
import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);
const flag = (name) => {
  const at = argv.indexOf(name);
  if (at < 0) return undefined;
  const value = argv[at + 1];
  argv.splice(at, value !== undefined && !value.startsWith('--') ? 2 : 1);
  return value ?? true;
};
const prompt = String(flag('--prompt') ?? 'Reply with exactly: ok');
const cwd = String(flag('--cwd') ?? process.cwd());
const timeout = Number(flag('--timeout') ?? 240_000);
const allow = Boolean(flag('--allow'));
const quiet = Boolean(flag('--quiet'));

const [command, ...args] = argv;
if (!command) {
  console.error('usage: node scripts/acp-probe.mjs [flags] <command> [args...]');
  process.exit(2);
}

const log = (...parts) => { if (!quiet) console.log(...parts); };
// Windows starts the command through a shell, which joins argv without quoting; a prompt with
// spaces would otherwise arrive as several arguments.
const quoted = (value) => (process.platform === 'win32' && /\s/.test(value) ? `"${value}"` : value);
const child = spawn(command, args.map(quoted), { stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32', cwd });
const pending = new Map();
let nextId = 1;

function send(method, params) {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return id;
}

function reply(id, result) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function fail(id, message) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message } }) + '\n');
}

/** Resolve when the agent answers the request we sent; reject on an error reply. */
function request(method, params) {
  const id = send(method, params);
  return new Promise((resolve, reject) => pending.set(id, { method, resolve, reject }));
}

let sawOutput = false;
let buffer = '';
let stderr = '';

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let at;
  while ((at = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, at).trim();
    buffer = buffer.slice(at + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      log('noise  ' + line.slice(0, 200));
      continue;
    }
    handle(message);
  }
});
child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

function handle(message) {
  // A request from the agent: answer it the way the app would.
  if (message.method && message.id !== undefined) {
    if (message.method === 'session/request_permission') {
      const options = message.params?.options ?? [];
      const pick = allow
        ? options.find((option) => String(option.kind ?? '').startsWith('allow')) ?? options[0]
        : options.find((option) => String(option.kind ?? '').startsWith('reject'));
      log('ask    ' + message.method + ' → ' + (pick ? `${pick.name} (${pick.kind})` : 'no option, cancelling'));
      if (pick) reply(message.id, { outcome: { outcome: 'selected', optionId: pick.optionId } });
      else reply(message.id, { outcome: { outcome: 'cancelled' } });
      return;
    }
    log('ask    ' + message.method + ' (refused: the app declares no fs/terminal capability)');
    fail(message.id, `probe does not implement ${message.method}`);
    return;
  }
  if (message.method) {
    const update = message.params?.update ?? {};
    const kind = String(update.sessionUpdate ?? '');
    if (kind === 'agent_message_chunk') log('text   ' + String(update.content?.text ?? '').slice(0, 200));
    else if (kind === 'agent_thought_chunk') log('think  ' + String(update.content?.text ?? '').slice(0, 120));
    else if (kind === 'tool_call') log('tool   ' + String(update.title ?? update.toolCallId ?? ''));
    else if (kind === 'plan') log(`plan   ${(update.entries ?? []).length} entries: ` + (update.entries ?? []).map((entry) => `${entry.status}:${String(entry.content ?? '').slice(0, 40)}`).join(' | '));
    else if (kind === 'available_commands_update') log(`cmds   ${(update.availableCommands ?? []).length}`);
    else if (kind === 'usage_update') log(`usage  used=${update.used} size=${update.size}` + (update.cost ? ` cost=${update.cost.amount} ${update.cost.currency}` : ''));
    else if (kind) log('update ' + kind);
    sawOutput = true;
    return;
  }
  // A reply to one of our requests.
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(`${waiter.method}: ${JSON.stringify(message.error)}`));
  else waiter.resolve(message.result);
}

child.on('error', (error) => {
  console.log(`FAILED to start: ${error.message}`);
  process.exit(2);
});
child.on('exit', (code) => {
  console.log(`agent exited early (code ${code})${stderr.trim() ? `: ${stderr.trim().slice(0, 300)}` : ''}`);
  process.exit(2);
});

const timer = setTimeout(() => {
  console.log(`TIMEOUT after ${timeout} ms`);
  if (stderr.trim()) console.log('stderr: ' + stderr.trim().slice(0, 500));
  child.kill();
  process.exit(2);
}, timeout);

try {
  const init = await request('initialize', {
    protocolVersion: 1,
    clientCapabilities: {},
    clientInfo: { name: 'vrykell-probe', title: 'vrykell-probe', version: '1' },
  });
  log(`agent  ${init?.agentInfo?.name ?? '?'} ${init?.agentInfo?.version ?? ''} (protocol ${init?.protocolVersion})`);
  if (init?.authMethods?.length) {
    log('auth   ' + init.authMethods.map((method) => `${method.name}: ${method.description ?? ''}`).join(' | '));
  }

  const session = await request('session/new', { cwd, mcpServers: [] });
  const sessionId = session?.sessionId ?? '';
  const modes = session?.modes
    ? ` modes=${(session.modes.availableModes ?? []).map((mode) => mode.id).join(',')} current=${session.modes.currentModeId}`
    : '';
  const models = session?.models
    ? ` models=${(session.models.availableModels ?? []).map((model) => model.modelId ?? model.id).join(',')} current=${session.models.currentModelId}`
    : '';
  log(`session ${sessionId}${modes}${models}`);

  const started = Date.now();
  const stop = await request('session/prompt', { sessionId, prompt: [{ type: 'text', text: prompt }] });
  console.log(`STOP   ${JSON.stringify(stop)} after ${Date.now() - started} ms${sawOutput ? '' : ' (no session updates arrived)'}`);
  clearTimeout(timer);
  child.kill();
  process.exit(0);
} catch (error) {
  console.log('ERROR  ' + error.message);
  if (stderr.trim()) console.log('stderr: ' + stderr.trim().slice(0, 500));
  clearTimeout(timer);
  child.kill();
  process.exit(1);
}
