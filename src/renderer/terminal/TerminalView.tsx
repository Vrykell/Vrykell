import React, { useCallback, useRef, memo } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { TerminalBuffer, TerminalLine } from './buffer';
import { LatexRenderer } from '../components/output/LatexRenderer';
import { MarkdownRenderer } from '../components/output/MarkdownRenderer';
import { CodeBlock } from '../components/output/CodeBlock';

// ── TextLine ───────────────────────────────────────────

const TextLine = memo(function TextLine({ line }: { line: TerminalLine }) {
  if (line.cells.length === 0) return <div style={{ height: 16 }} />;

  return (
    <div style={{ whiteSpace: 'pre', fontFamily: 'Menlo, monospace', fontSize: 14, lineHeight: '16px', minHeight: 16 }}>
      {line.cells.map((cell, i) => {
        const style: React.CSSProperties = {};
        if (cell.fg) style.color = cell.fg;
        if (cell.bg) style.backgroundColor = cell.bg;
        if (cell.bold) style.fontWeight = 'bold';
        if (cell.italic) style.fontStyle = 'italic';
        if (cell.underline) style.textDecoration = 'underline';
        return <span key={i} style={style}>{cell.char}</span>;
      })}
    </div>
  );
});

// ── RichBlockLine ──────────────────────────────────────

const RichBlockLine = memo(function RichBlockLine({ line }: { line: TerminalLine }) {
  if (!line.richBlock) return null;
  const { type, content, language, display } = line.richBlock;

  switch (type) {
    case 'latex':
      return <LatexRenderer content={content} display={display || 'block'} />;
    case 'markdown':
      return <MarkdownRenderer content={content} />;
    case 'code':
      return <CodeBlock content={content} language={language} />;
    case 'image':
      return <img src={content} alt="" style={{ maxWidth: '100%', display: 'block' }} />;
    default:
      return <TextLine line={line} />;
  }
});

// ── TerminalView ──────────────────────────────────────

interface TerminalViewProps {
  buffer: TerminalBuffer;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

export const DomTerminalView: React.FC<TerminalViewProps> = ({ buffer, onKeyDown }) => {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const followRef = useRef(true);

  const rowRenderer = useCallback((index: number) => {
    const line = buffer.lines[index];
    if (!line) return <div style={{ height: 16 }} />;

    if (line.richBlock) {
      return (
        <div style={{ padding: '2px 0' }}>
          <RichBlockLine line={line} />
        </div>
      );
    }

    return <TextLine line={line} />;
  }, [buffer]);

  // Track if user scrolled away from bottom
  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    followRef.current = atBottom;
  }, []);

  return (
    <div
      style={{ height: '100%', background: '#1e1e1e', color: '#d4d4d4' }}
      onKeyDown={onKeyDown}
      tabIndex={0}
    >
      <Virtuoso
        ref={virtuosoRef}
        totalCount={buffer.lines.length}
        itemContent={rowRenderer}
        followOutput={followRef.current}
        atBottomStateChange={handleAtBottomStateChange}
        style={{ height: '100%' }}
        increaseViewportBy={{ top: 200, bottom: 200 }}
      />
    </div>
  );
};
