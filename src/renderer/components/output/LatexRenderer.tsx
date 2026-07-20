import React, { useMemo } from 'react';
import katex from 'katex';

interface LatexRendererProps {
  content: string;
  display?: 'inline' | 'block';
}

/**
 * Render LaTeX math using KaTeX.
 * Falls back to displaying raw LaTeX source on error.
 */
export const LatexRenderer: React.FC<LatexRendererProps> = ({ content, display = 'block' }) => {
  const html = useMemo(() => {
    try {
      return katex.renderToString(content, {
        displayMode: display === 'block',
        throwOnError: false,
        strict: false,
        trust: false,
      });
    } catch {
      // KaTeX render failure → show raw LaTeX source
      return null;
    }
  }, [content, display]);

  if (html) {
    return (
      <span
        className={`latex-rendered latex-${display}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  // Fallback: raw LaTeX source
  return (
    <code
      className="latex-fallback"
      style={{
        color: '#808080',
        fontFamily: 'monospace',
        fontSize: '13px',
        whiteSpace: 'pre-wrap',
      }}
    >
      {content}
    </code>
  );
};
