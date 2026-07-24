import * as pty from 'node-pty';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = process.env.BRIDGE_PORT ? Number(process.env.BRIDGE_PORT) : 19421;

interface Session {
  pty: pty.IPty;
  shell: string;
}

const sessions = new Map<string, Session>();
let nextId = 1;

function send(ws: WebSocket, message: unknown) {
  ws.send(JSON.stringify(message));
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case 'invoke': {
        const { id, cmd, args } = msg;
        handleInvoke(ws, id, cmd, args);
        break;
      }
      case 'listen': {
        // Events are pushed automatically; no subscription needed at server level.
        break;
      }
    }
  });
});

function handleInvoke(ws: WebSocket, id: string, cmd: string, args: any) {
  switch (cmd) {
    case 'create_pty': {
      const shell = args?.shell || process.env.SHELL || '/bin/zsh';
      const cwd = args?.cwd || process.env.HOME || '/';
      const cols = args?.cols || 80;
      const rows = args?.rows || 24;
      const sid = `e2e-${nextId++}`;
      // Spawn login shells with no rc files for deterministic E2E output
      const noRc = /zsh$/.test(shell) ? ['-f'] : /bash$/.test(shell) ? ['--noprofile', '--norc'] : [];
      const proc = pty.spawn(shell, noRc, {
        name: 'xterm-256color',
        cwd,
        env: process.env as { [key: string]: string },
        cols,
        rows,
      });
      sessions.set(sid, { pty: proc, shell });
      proc.onData((data) => {
        // Tag each batch with the CURRENT PTY dims, mirroring the Rust
        // backend, so the frontend applies output at the width it was
        // generated at (resize-race fix).
        send(ws, { event: 'pty:output', payload: { sessionId: sid, data, cols: proc.cols, rows: proc.rows } });
      });
      proc.onExit(({ exitCode }) => {
        send(ws, { event: 'pty:exit', payload: { sessionId: sid, exitCode: exitCode ?? 0 } });
        sessions.delete(sid);
      });
      // Matches real Rust backend: create_pty returns SessionInfo via invoke;
      // it does NOT emit session:created.
      send(ws, { id, result: {
        id: sid,
        type: 'local',
        title: shell.split('/').pop() || 'bash',
        cwd,
        shell,
        cols,
        rows,
        createdAt: Date.now(),
      }});
      break;
    }
    case 'write_pty': {
      const session = sessions.get(args?.sessionId);
      if (session) session.pty.write(args.data);
      send(ws, { id, result: null });
      break;
    }
    case 'resize_pty': {
      const session = sessions.get(args?.sessionId);
      if (session) session.pty.resize(args.cols, args.rows);
      send(ws, { id, result: null });
      break;
    }
    case 'close_pty': {
      const session = sessions.get(args?.sessionId);
      if (session) session.pty.kill();
      sessions.delete(args?.sessionId);
      send(ws, { id, result: null });
      break;
    }
    case 'list_pty': {
      send(ws, { id, result: Array.from(sessions.values()).map((s) => ({
        id: s.shell,
        type: 'local',
        title: s.shell.split('/').pop() || 'bash',
      })) });
      break;
    }
    default:
      send(ws, { id, error: `Unknown command: ${cmd}` });
  }
}

console.log(`E2E PTY bridge listening on ws://127.0.0.1:${PORT}`);
