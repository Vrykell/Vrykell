// Browser-side E2E bridge replacing @tauri-apps/api/core and @tauri-apps/api/event.
// Plain JS: this file is loaded via vite alias outside the TS project root.
let socket = null;
const pending = new Map();
const listeners = new Map();
let callId = 1;

function connect() {
  if (socket) return;
  socket = new WebSocket('ws://127.0.0.1:19421');
  socket.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if ('id' in msg && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.result);
    } else if (msg.event) {
      // Mirror real Tauri: listeners receive { event, id, payload }
      (listeners.get(msg.event) || []).forEach((cb) =>
        cb({ event: msg.event, id: 0, payload: msg.payload }),
      );
    }
  };
}

export function invoke(cmd, args) {
  connect();
  const id = callId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const waitAndSend = () => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'invoke', id, cmd, args }));
      } else {
        setTimeout(waitAndSend, 50);
      }
    };
    waitAndSend();
  });
}

export function listen(event, cb) {
  connect();
  const list = listeners.get(event) || [];
  list.push(cb);
  listeners.set(event, list);
  return Promise.resolve(() => {
    const list = listeners.get(event) || [];
    listeners.set(event, list.filter((f) => f !== cb));
  });
}
