import { useEffect, useState } from 'react';

const LANGUAGES: Record<string, string> = { js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', sh: 'shell', bash: 'shell', zsh: 'shell', py: 'python', rs: 'rust', yml: 'yaml', toml: 'ini' };
interface Token { offset: number; type: string }
export default function CodeSyntax({ text, language }: { text: string; language: string }) {
  const [highlight, setHighlight] = useState<{ text: string; language: string; lines: Token[][] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!language || text.length > 200_000) return;
    void import('@ui/editor/code/runtime').then(async ({ editorApi }) => {
      const resolved = LANGUAGES[language.toLowerCase()] ?? language.toLowerCase();
      if (!editorApi.languages.getLanguages().some(item => item.id === resolved)) return;
      await editorApi.editor.colorize(text, resolved, {});
      if (!cancelled) setHighlight({ text, language, lines: editorApi.editor.tokenize(text, resolved) });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [text, language]);
  const tokensByLine = highlight?.text === text && highlight.language === language ? highlight.lines : null;
  const lines = text.split('\n');
  return <code className={language ? `language-${language}` : undefined}>{tokensByLine ? lines.map((line, lineIndex) => <span key={lineIndex}>
    {(tokensByLine[lineIndex] ?? [{ offset: 0, type: '' }]).map((token, index, tokens) => {
      const color = /comment/.test(token.type) ? '--text-muted' : /string/.test(token.type) ? '--cmd-string' : /keyword/.test(token.type) ? '--cmd-variable' : /number/.test(token.type) ? '--cmd-number' : /type|tag/.test(token.type) ? '--cmd-program' : '--text-primary';
      return <span key={index} data-code-token={token.type || undefined} style={{ color: `var(${color})` }}>{line.slice(token.offset, tokens[index + 1]?.offset)}</span>;
    })}{lineIndex < lines.length - 1 ? '\n' : ''}
  </span>) : text}</code>;
}
