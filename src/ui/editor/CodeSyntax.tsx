import { useEffect, useMemo, useState } from 'react';

const LANGUAGES: Record<string, string> = { js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', sh: 'shell', bash: 'shell', zsh: 'shell', py: 'python', rs: 'rust', yml: 'yaml', toml: 'ini' };
const MAX_HIGHLIGHT_LENGTH = 200_000;

type EditorApi = typeof import('@ui/editor/code/runtime')['editorApi'];

/** The editor runtime is large: load it once for every code block in the transcript. */
let runtimePromise: Promise<EditorApi> | null = null;
let resolvedRuntime: EditorApi | null = null;
/** Languages whose tokenizer has finished loading, so tokenization can run synchronously. */
const readyLanguages = new Set<string>();
const languageLoads = new Map<string, Promise<void>>();

function loadRuntime(): Promise<EditorApi> {
  if (resolvedRuntime) return Promise.resolve(resolvedRuntime);
  runtimePromise ??= import('@ui/editor/code/runtime')
    .then(module => {
      resolvedRuntime = module.editorApi;
      return resolvedRuntime;
    })
    .catch((error: unknown) => {
      runtimePromise = null; // A chunk that failed to load can succeed on the next mount.
      throw error;
    });
  return runtimePromise;
}

function resolveLanguage(api: EditorApi, language: string): string | null {
  const resolved = LANGUAGES[language.toLowerCase()] ?? language.toLowerCase();
  return api.languages.getLanguages().some(item => item.id === resolved) ? resolved : null;
}

/**
 * Force the tokenizer for a language to load. Colorizing produces HTML we discard, but it waits
 * for the lazy language definition, after which `tokenize` returns real tokens synchronously.
 */
function ensureLanguage(api: EditorApi, language: string): Promise<void> {
  const pending = languageLoads.get(language);
  if (pending) return pending;
  const load = api.editor.colorize('', language, {})
    .then(() => { readyLanguages.add(language); })
    .finally(() => { languageLoads.delete(language); });
  languageLoads.set(language, load);
  return load;
}

function tokenColor(type: string): string {
  if (/comment/.test(type)) return '--text-muted';
  if (/string/.test(type)) return '--cmd-string';
  if (/keyword/.test(type)) return '--cmd-variable';
  if (/number/.test(type)) return '--cmd-number';
  if (/type|tag/.test(type)) return '--cmd-program';
  return '--text-primary';
}

export default function CodeSyntax({ text, language }: { text: string; language: string }) {
  const [api, setApi] = useState<EditorApi | null>(resolvedRuntime);
  const [readyVersion, setReadyVersion] = useState(0);

  useEffect(() => {
    if (api || !language) return;
    let cancelled = false;
    void loadRuntime().then(loaded => { if (!cancelled) setApi(loaded); }).catch(() => {});
    return () => { cancelled = true; };
  }, [api, language]);

  const resolved = api && language ? resolveLanguage(api, language) : null;

  useEffect(() => {
    if (!api || !resolved || readyLanguages.has(resolved)) return;
    let cancelled = false;
    void ensureLanguage(api, resolved)
      .then(() => { if (!cancelled) setReadyVersion(version => version + 1); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [api, resolved]);

  // Once the language is ready tokenization is synchronous, so a streamed chunk keeps the colors
  // already on screen instead of falling back to plain text while a highlight pass is pending.
  const tokensByLine = useMemo(() => {
    if (!api || !resolved || text.length > MAX_HIGHLIGHT_LENGTH || !readyLanguages.has(resolved)) return null;
    return api.editor.tokenize(text, resolved);
  }, [api, resolved, text, readyVersion]);

  const lines = text.split('\n');
  return <code className={language ? `language-${language}` : undefined}>{tokensByLine ? lines.map((line, lineIndex) => <span key={lineIndex}>
    {(tokensByLine[lineIndex] ?? [{ offset: 0, type: '' }]).map((token, index, tokens) => (
      <span key={index} data-code-token={token.type || undefined} style={{ color: `var(${tokenColor(token.type)})` }}>{line.slice(token.offset, tokens[index + 1]?.offset)}</span>
    ))}{lineIndex < lines.length - 1 ? '\n' : ''}
  </span>) : text}</code>;
}
