import Markdown from './Markdown';
import type { ChatMessage } from '../stores/chat';

export default function MessageItem({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div style={{
      alignSelf: isUser ? 'flex-end' : 'stretch',
      maxWidth: isUser ? '80%' : '100%',
      background: isUser ? '#1f6feb33' : 'transparent',
      borderRadius: 8, padding: '6px 10px',
    }}>
      {isUser ? message.content : <Markdown content={message.content} />}
      {message.pending && <span style={{ opacity: 0.5 }}>▍</span>}
    </div>
  );
}
