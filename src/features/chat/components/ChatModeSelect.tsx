import { useAgentSettings, useAiConfigStore } from '@features/agent';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

const MODES = [
  { id: 'chat', label: 'Chat 模式', description: '对话、解答与探索' },
  { id: 'agent', label: 'Agent 模式', description: '使用工具，执行与完成任务' },
] as const;

export default function ChatModeSelect() {
  const activeModel = useAiConfigStore(state => state.activeModel);
  const settings = useAgentSettings();
  const agentMode = settings.resolve(activeModel).agentMode;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    if (!open) return;
    options.current[agentMode ? 1 : 0]?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, agentMode]);
  useEffect(() => { setOpen(false); }, [activeModel]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  return <div ref={root} style={{ position: 'relative', flexShrink: 0 }}>
    <button ref={trigger} type="button" data-subtle className="chat-mode-trigger" aria-label="对话模式" aria-haspopup="listbox" aria-expanded={open}
      onClick={() => setOpen(!open)} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
      }}
      style={{ display: 'flex', alignItems: 'center', gap: 6, height: 30, padding: '0 10px', borderRadius: 8,
        border: 'none', color: 'var(--text-primary)',
        fontSize: 'calc(12px * var(--ui-font-scale))', cursor: 'pointer' }}>
      {agentMode ? 'Agent 模式' : 'Chat 模式'}<ChevronDown size={13} />
    </button>
    {open && <div role="listbox" aria-label="选择对话模式" className="workspace-floating"
      style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 200, width: 280,
        maxWidth: 'calc(100vw - 32px)', padding: 6, borderRadius: 18 }}>
      {MODES.map((mode, index) => {
        const selected = agentMode === (mode.id === 'agent');
        return <button key={mode.id} ref={element => { options.current[index] = element; }} type="button" data-subtle role="option"
          aria-selected={selected} className="workspace-floating-row chat-mode-option" data-selected={selected}
          onClick={() => { settings.updateModel(activeModel, { agentMode: mode.id === 'agent' }); close(); }}
          onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
            else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index;
              options.current[next]?.focus();
            } else if (event.key === 'Tab') setOpen(false);
          }}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3, width: '100%',
            padding: '12px 10px', borderRadius: 12, textAlign: 'left', cursor: 'pointer', color: 'var(--text-primary)' }}>
          <span style={{ fontSize: 'calc(14px * var(--ui-font-scale))', fontWeight: 500 }}>{mode.label}</span>
          <span style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-muted)' }}>{mode.description}</span>
        </button>;
      })}
    </div>}
  </div>;
}
