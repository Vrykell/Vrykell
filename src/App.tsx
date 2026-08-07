import { useEffect } from 'react';
import ChatView from './chat/ChatView';
import ApiKeyField from './chat/ApiKeyField';
import TerminalPanel from './terminal/TerminalPanel';
import { setDefaultStream } from './stores/chat';
import { useTerminalStore } from './stores/terminal';
import { anthropicStream } from './lib/ai';

export default function App() {
  const visible = useTerminalStore((s) => s.visible);
  const toggle = useTerminalStore((s) => s.toggle);
  const setSession = useTerminalStore((s) => s.setSession);
  useEffect(() => setDefaultStream(anthropicStream), []);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0e0f11', color: '#e6e8eb' }}>
      <ApiKeyField />
      <div style={{ flex: 1, minHeight: 0 }}>
        <ChatView />
      </div>
      <div style={{ borderTop: '1px solid #ffffff14' }}>
        <button onClick={toggle} style={{ fontSize: 12, opacity: 0.7, margin: '4px 8px' }}>
          {visible ? '▾ 收起终端' : '▸ 展开终端'}
        </button>
        {visible && (
          <div style={{ height: 260 }}>
            <TerminalPanel onReady={setSession} />
          </div>
        )}
      </div>
    </div>
  );
}
