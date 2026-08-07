import { useEffect } from 'react';
import ChatView from './chat/ChatView';
import ApiKeyField from './chat/ApiKeyField';
import { setDefaultStream } from './stores/chat';
import { anthropicStream } from './lib/ai';

export default function App() {
  useEffect(() => setDefaultStream(anthropicStream), []);
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0e0f11', color: '#e6e8eb' }}>
      <ApiKeyField />
      <div style={{ flex: 1, minHeight: 0 }}>
        <ChatView />
      </div>
    </div>
  );
}
