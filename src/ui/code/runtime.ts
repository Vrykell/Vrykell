import * as editorApi from 'monaco-editor/esm/vs/editor/editor.api';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import 'monaco-editor/esm/vs/editor/contrib/find/browser/findController';
import 'monaco-editor/esm/vs/editor/contrib/folding/browser/folding';
import 'monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution';
import 'monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard';
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution';
import 'monaco-editor/esm/vs/basic-languages/rust/rust.contribution';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution';
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution';
import 'monaco-editor/esm/vs/basic-languages/css/css.contribution';
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution';
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution';
import 'monaco-editor/esm/vs/basic-languages/ini/ini.contribution';
import 'monaco-editor/esm/vs/basic-languages/go/go.contribution';
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution';

const environment = globalThis as typeof globalThis & { MonacoEnvironment?: editorApi.Environment };
environment.MonacoEnvironment = { getWorker: () => new EditorWorker() };

editorApi.languages.register({ id: 'json', extensions: ['.json', '.jsonc'] });
editorApi.languages.setMonarchTokensProvider('json', {
  tokenizer: { root: [
    [/"(?:[^"\\]|\\.)*"/, 'string'],
    [/\b(?:true|false|null)\b/, 'keyword'],
    [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
    [/\/\/.*$/, 'comment'],
    [/[{}\[\]:,]/, 'delimiter'],
  ] },
});

/** Convert resolved theme colors to the editor's hexadecimal format. */
function color(style: CSSStyleDeclaration, property: string): string | undefined {
  const value = style.getPropertyValue(property).trim();
  if (/^#[\da-f]{6}([\da-f]{2})?$/i.test(value)) return value;
  const channels = value.startsWith('rgb') ? value.match(/[\d.]+/g)?.map(Number) : undefined;
  if (!channels || channels.length < 3) return undefined;
  return `#${channels.slice(0, 3).map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}${channels.length > 3 ? Math.round(channels[3] * 255).toString(16).padStart(2, '0') : ''}`;
}

export function applyCodeTheme() {
  const style = getComputedStyle(document.documentElement);
  const definitions: Record<string, string> = {
    'editor.background': '--canvas', 'editor.foreground': '--text-primary',
    'editorLineNumber.foreground': '--text-muted', 'editorLineNumber.activeForeground': '--text-primary',
    'editor.selectionBackground': '--selection-bg', 'editor.inactiveSelectionBackground': '--selection-bg',
    'editorGutter.background': '--canvas', 'editorWidget.background': '--elevated',
    'editorWidget.border': '--border', 'editor.lineHighlightBackground': '--surface',
    'editorCursor.foreground': '--text-primary', 'editor.findMatchBackground': '--search-highlight-bg',
    'diffEditor.insertedTextBackground': '--success-bg', 'diffEditor.removedTextBackground': '--error-bg',
    'diffEditor.insertedLineBackground': '--success-bg', 'diffEditor.removedLineBackground': '--error-bg',
    'diffEditor.border': '--border', 'focusBorder': '--focus-ring',
  };
  const colors: Record<string, string> = {};
  for (const [key, variable] of Object.entries(definitions)) {
    const resolved = color(style, variable);
    if (resolved) colors[key] = resolved;
  }
  const transparent = color(style, '--canvas')?.slice(0, 7);
  if (transparent) for (const key of ['editor.lineHighlightBorder', 'diffEditor.border', 'diffEditor.insertedTextBorder', 'diffEditor.removedTextBorder', 'diffEditor.diagonalFill', 'editorOverviewRuler.border', 'scrollbar.shadow']) colors[key] = `${transparent}00`;
  const tokens = { comment: '--text-muted', keyword: '--cmd-variable', string: '--cmd-string', number: '--cmd-number', type: '--cmd-program' };
  editorApi.editor.defineTheme('workspace-code', {
    base: document.documentElement.dataset.theme === 'light' ? 'vs' : 'vs-dark', inherit: true,
    colors, rules: Object.entries(tokens).flatMap(([token, variable]) => {
      const foreground = color(style, variable);
      return foreground ? [{ token, foreground: foreground.slice(1, 7) }] : [];
    }),
  });
  editorApi.editor.setTheme('workspace-code');
}

export function languageForFile(path: string): string {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const languages: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', json: 'json', jsonc: 'json',
    rs: 'rust', py: 'python', sh: 'shell', bash: 'shell', zsh: 'shell', md: 'markdown',
    css: 'css', scss: 'css', html: 'html', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini',
    go: 'go', c: 'cpp', cpp: 'cpp', h: 'cpp', hpp: 'cpp',
  };
  return languages[extension] ?? 'plaintext';
}

export { editorApi };
