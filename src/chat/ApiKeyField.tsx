import { useState } from 'react';
import { getApiKey, setApiKey } from '../lib/ai';

export default function ApiKeyField() {
  const [key, setKey] = useState(getApiKey() ?? '');
  const [saved, setSaved] = useState(!!getApiKey());
  if (saved) return null;
  return (
    <div style={{ display: 'flex', gap: 8, padding: '8px 12px', background: '#b45309aa' }}>
      <input
        type="password"
        value={key}
        placeholder="输入 Anthropic API Key（sk-ant-...），仅存在本机"
        style={{ flex: 1, background: 'transparent', border: 'none', color: 'inherit' }}
        onChange={(e) => setKey(e.target.value)}
      />
      <button onClick={() => { setApiKey(key); setSaved(true); }}>保存</button>
    </div>
  );
}
