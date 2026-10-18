/**
 * acp-probe — verify an ACP agent outside the app.
 *
 * Spawns the given command, speaks the `initialize` handshake over stdio (newline-delimited
 * JSON-RPC, the same framing the app uses) and prints the reply. Handy when an agent fails to
 * connect: the reply carries the agent's capabilities and, when it needs one, its auth methods.
 *
 *   node scripts/acp-probe.mjs opencode acp
 *   node scripts/acp-probe.mjs npx -y @zed-industries/claude-code-acp
 */
import { spawn } from 'node:child_process';

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('usage: node scripts/acp-probe.mjs <command> [args...]');
  process.exit(2);
}

const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' });
const request = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: 1,
    clientCapabilities: {},
    clientInfo: { name: 'probe', title: 'probe', version: '1' },
  },
}) + '\n';

let out = '';
let err = '';
child.stdout.on('data', (chunk) => {
  out += chunk.toString();
  if (out.includes('\n')) {
    console.log('REPLY: ' + out.split('\n')[0]);
    child.kill();
    process.exit(0);
  }
});
child.stderr.on('data', (chunk) => { err += chunk.toString(); });
child.stdin.write(request);

setTimeout(() => {
  console.log('TIMEOUT');
  console.log('stdout: ' + out.slice(0, 400));
  console.log('stderr: ' + err.slice(0, 400));
  child.kill();
  process.exit(1);
}, 25000);
