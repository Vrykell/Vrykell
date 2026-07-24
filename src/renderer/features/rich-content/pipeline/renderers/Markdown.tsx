import React, { useMemo } from 'react';
import { marked } from 'marked';

interface MarkdownRendererProps {
  content: string;
}

/**
 * Render Markdown content using marked.
 * Includes basic styling for terminal-like appearance.
 */
export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  const html = useMemo(() => {
    try {
      return marked.parse(content, { async: false }) as string;
    } catch {
      return null;
    }
  }, [content]);

  if (!html) {
    return (
      <pre style={{ color: '#d4d4d4', whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '13px' }}>
        {content}
      </pre>
    );
  }

  return (
    <div
      className="markdown-rendered"
      dangerouslySetInnerHTML={{ __html: html }}
      style={{
        color: '#d4d4d4',
        fontSize: '13px',
        lineHeight: '1.6',
      }}
    />
  );
};
