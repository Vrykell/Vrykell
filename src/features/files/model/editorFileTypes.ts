/** File types that can be opened as text by the embedded editor. */
const textExtensions = new Set([
  'txt', 'text', 'log', 'md', 'markdown', 'rst', 'adoc', 'csv', 'tsv',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts', 'json', 'jsonc', 'jsonl',
  'html', 'htm', 'css', 'scss', 'sass', 'less', 'vue', 'svelte', 'astro',
  'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hxx', 'cs', 'java', 'kt', 'kts', 'go', 'rs', 'py', 'pyi',
  'rb', 'php', 'swift', 'm', 'mm', 'dart', 'lua', 'r', 'scala', 'sql', 'graphql', 'proto',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'psd1', 'bat', 'cmd',
  'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'config', 'properties', 'env', 'xml', 'svg',
  'diff', 'patch', 'lock', 'gradle', 'cmake', 'tex', 'bib', 'editorconfig',
]);

const textNames = new Set([
  'dockerfile', 'containerfile', 'makefile', 'gnumakefile', 'cmakelists.txt',
  'license', 'licence', 'notice', 'readme', 'changelog', 'authors', 'copying',
  '.gitignore', '.gitattributes', '.gitmodules', '.editorconfig', '.dockerignore',
  '.npmrc', '.yarnrc', '.nvmrc', '.bashrc', '.bash_profile', '.zshrc', '.profile', '.env',
]);

export function isSupportedEditorFile(path: string): boolean {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  if (textNames.has(name) || name.startsWith('.env.')) return true;
  const dot = name.lastIndexOf('.');
  return dot > 0 && textExtensions.has(name.slice(dot + 1));
}
