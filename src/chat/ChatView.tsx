import { useEffect, useRef } from 'react';
import { useChatStore } from '../stores/chat';
import MessageItem from './MessageItem';
import ChatInput from './ChatInput';

export default function ChatView() {
  const messages = useChatStore((s) => s.messages);
  const send = useChatStore((s) => s.send);
  const sending = useChatStore((s) => s.sending);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, messages[messages.length - 1]?.content.length]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length === 0 && (
          <div style={{ opacity: 0.5, textAlign: 'center', marginTop: 40 }}>
            问点什么吧——支持 Markdown / LaTeX 渲染，shell 代码块可一键在终端运行。
          </div>
        )}
        {messages.map((m) => <MessageItem key={m.id} message={m} />)}
        <div ref={bottomRef} />
      </div>
      <ChatInput onSend={send} disabled={sending} />
    </div>
  );
}
