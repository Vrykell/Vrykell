import React from 'react';
import { useTerminalStore } from '../../../stores/terminal-store';
import { RichOutputItem } from '../../../../shared/types/index';
import { LatexRenderer } from '../pipeline/renderers/Latex';
import { MarkdownRenderer } from '../pipeline/renderers/Markdown';
import { CodeBlock } from '../pipeline/renderers/Code';

// Stable empty array reference to prevent Zustand infinite re-render loop
const EMPTY_OUTPUTS: RichOutputItem[] = [];

/**
 * Rich Output Panel — displays detected LaTeX, Markdown, code blocks,
 * tables, and images from terminal output below the terminal viewport.
 */
export const RichOutput: React.FC = () => {
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const outputs = useTerminalStore(
    (s) => (activeSessionId ? (s.richOutputs[activeSessionId] ?? EMPTY_OUTPUTS) : EMPTY_OUTPUTS)
  );
  const height = useTerminalStore((s) => s.outputPanelHeight);

  if (outputs.length === 0) {
    return null;
  }

  const handleClear = (): void => {
    if (activeSessionId) {
      useTerminalStore.getState().clearOutputs(activeSessionId);
    }
  };

  return (
    <div
      style={{
        height: `${height}px`,
        borderTop: '2px solid #007acc',
        background: '#1e1e1e',
        overflow: 'auto',
        flexShrink: 0,
      }}
    >
      {/* Panel header */}
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
          position: 'sticky',
          top: 0,
          zIndex: 1,
        }}
      >
        <span>📄 Rich Output ({outputs.length})</span>
        <button
          onClick={handleClear}
          style={{
            background: 'none',
            border: 'none',
            color: '#999',
            cursor: 'pointer',
            fontSize: '12px',
            padding: '2px 8px',
            borderRadius: '3px',
          }}
        >
          Clear
        </button>
      </div>

      {/* Output items */}
      <div style={{ padding: '12px' }}>
        {outputs.map((item) => (
          <OutputItem key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
};

// ── Per-Item Renderer ─────────────────────────────────────────

const OutputItem: React.FC<{ item: RichOutputItem }> = ({ item }) => {
  const typeLabel = getTypeLabel(item.type);

  return (
    <div
      style={{
        marginBottom: '12px',
        background: '#2d2d2d',
        borderRadius: '4px',
        overflow: 'hidden',
      }}
    >
      {/* Type badge */}
      <div
        style={{
          fontSize: '11px',
          color: '#569cd6',
          padding: '4px 12px',
          background: '#333',
          borderBottom: '1px solid #3c3c3c',
        }}
      >
        {typeLabel}
        {item.language && ` — ${item.language}`}
      </div>

      {/* Content (rendered by type) */}
      <div style={{ padding: '12px' }}>
        <RenderContent item={item} />
      </div>

      {/* Timestamp */}
      <div
        style={{
          fontSize: '10px',
          color: '#555',
          padding: '2px 12px 6px',
          textAlign: 'right',
        }}
      >
        {new Date(item.timestamp).toLocaleTimeString()}
      </div>
    </div>
  );
};

/** Route to the correct renderer based on content type */
const RenderContent: React.FC<{ item: RichOutputItem }> = ({ item }) => {
  switch (item.type) {
    case 'latex':
      return <LatexRenderer content={item.content} display={item.display} />;

    case 'markdown':
      return <MarkdownRenderer content={item.content} />;

    case 'code':
      return <CodeBlock content={item.content} language={item.language} />;

    case 'table':
      // Tables are rendered as Markdown (marked handles GFM tables)
      return <MarkdownRenderer content={item.content} />;

    case 'image':
      return (
        <div style={{ color: '#808080', fontSize: '12px', fontStyle: 'italic' }}>
          📷 Image rendering will be available in Phase 3
          <pre style={{ marginTop: '4px', whiteSpace: 'pre-wrap', fontSize: '11px' }}>
            {item.content}
          </pre>
        </div>
      );

    default:
      return (
        <pre style={{ color: '#d4d4d4', whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '13px', margin: 0 }}>
          {item.content}
        </pre>
      );
  }
};

function getTypeLabel(type: string): string {
  switch (type) {
    case 'latex': return '📐 LaTeX';
    case 'markdown': return '📝 Markdown';
    case 'code': return '💻 Code';
    case 'table': return '📊 Table';
    case 'image': return '🖼️ Image';
    default: return type;
  }
}
