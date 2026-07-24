import React, { useEffect, useState } from 'react';
import { createHighlighter, Highlighter } from 'shiki';

interface CodeBlockProps {
  content: string;
  language?: string;
}

// Singleton highlighter — created once, reused for all code blocks
let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['dark-plus'],
      langs: [
        'javascript', 'typescript', 'python', 'rust', 'go',
        'bash', 'shell', 'json', 'yaml', 'markdown',
        'css', 'html', 'sql', 'java', 'c', 'cpp',
        'ruby', 'php', 'swift', 'kotlin', 'lua', 'r',
        'xml', 'toml', 'diff', 'dockerfile', 'makefile',
      ],
    });
  }
  return highlighterPromise;
}

/**
 * Render syntax-highlighted code using Shiki.
 * Shows loading state then rendered HTML, with a Copy button.
 */
export const CodeBlock: React.FC<CodeBlockProps> = ({ content, language }) => {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getHighlighter()
      .then((highlighter) => {
        if (cancelled) return;
        const lang = language && highlighter.getLoadedLanguages().includes(language)
          ? language
          : 'text';
        try {
          const result = highlighter.codeToHtml(content.trimEnd(), {
            lang,
            theme: 'dark-plus',
          });
          if (!cancelled) setHtml(result);
        } catch {
          if (!cancelled) setHtml(null); // fallback to plain
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });

    return () => { cancelled = true; };
  }, [content, language]);

  const handleCopy = (): void => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // Clipboard write failed (non-secure context) — silently ignore
    });
  };

  return (
    <div
      className="code-block"
      style={{
        background: '#1e1e1e',
        borderRadius: '4px',
        overflow: 'hidden',
        border: '1px solid #3c3c3c',
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '4px 12px',
          background: '#333',
          fontSize: '12px',
          color: '#999',
        }}
      >
        <span>{language || 'text'}</span>
        <button
          onClick={handleCopy}
          style={{
            background: copied ? '#264f78' : 'transparent',
            border: 'none',
            color: copied ? '#fff' : '#999',
            cursor: 'pointer',
            fontSize: '12px',
            padding: '2px 8px',
            borderRadius: '3px',
          }}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      {/* Code content */}
      <div style={{ padding: '12px', overflow: 'auto', maxHeight: '400px' }}>
        {error ? (
          <pre style={{ color: '#f14c4c', margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '13px' }}>
            Highlight error: {error}
          </pre>
        ) : html ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre style={{ color: '#d4d4d4', margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '13px' }}>
            {content}
          </pre>
        )}
      </div>
    </div>
  );
};
