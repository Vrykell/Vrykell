import { useState } from 'react';

export default function ChatInput({ onSend, disabled }: {
  onSend: (text: string) => void;
  disabled: boolean;
}) {
  const [text, setText] = useState('');
  const submit = () => {
    if (!text.trim() || disabled) return;
    onSend(text);
    setText('');
  };
  return (
    <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid #ffffff14' }}>
      <textarea
        value={text}
        placeholder="输入消息，Enter 发送，Shift+Enter 换行"
        rows={2}
        style={{ flex: 1, resize: 'none', background: '#ffffff0a', color: 'inherit', border: 'none', borderRadius: 6, padding: 8 }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button onClick={submit} disabled={disabled} style={{ padding: '0 16px' }}>发送</button>
    </div>
  );
}
