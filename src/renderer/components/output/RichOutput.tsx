import React from 'react';
import { useTerminalStore } from '../../stores/terminal-store';
// Phase 2 will add: MarkdownRenderer, LatexRenderer, CodeBlock

export const RichOutput: React.FC = () => {
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const outputs = useTerminalStore(
    (s) => (activeSessionId ? s.richOutputs[activeSessionId] : []) || []
  );
  const height = useTerminalStore((s) => s.outputPanelHeight);

  if (outputs.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        height: `${height}px`,
        borderTop: '2px solid #007acc',
        background: '#1e1e1e',
        overflow: 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 12px',
          background: '#252526',
          borderBottom: '1px solid #3c3c3c',
          fontSize: '12px',
          color: '#999',
        }}
      >
        <span>Rich Output ({outputs.length})</span>
        <button
          onClick={() => {
            if (activeSessionId) {
              useTerminalStore.getState().clearOutputs(activeSessionId);
            }
          }}
          style={{ background: 'none', border: 'none', color: '#999', cursor: 'pointer', fontSize: '12px' }}
        >
          Clear
        </button>
      </div>
      <div style={{ padding: '12px' }}>
        {outputs.map((item) => (
          <div
            key={item.id}
            style={{
              marginBottom: '12px',
              padding: '8px 12px',
              background: '#2d2d2d',
              borderRadius: '4px',
              fontSize: '13px',
              color: '#d4d4d4',
              fontFamily: 'monospace',
              whiteSpace: 'pre-wrap',
            }}
          >
            {/* Phase 2: Replace with actual renderers */}
            <div style={{ color: '#569cd6', fontSize: '11px', marginBottom: '4px' }}>
              [{item.type}]
            </div>
            <div>{item.content}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
