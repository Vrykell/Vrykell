/** Quote a literal directory according to the pane's actual command language. */
export function directoryCommand(path: string, shell: string = 'zsh'): string {
  if (/[\x00-\x1f\x7f-\x9f]/.test(path)) throw new Error('Invalid directory path');
  if (shell === 'cmd') {
    if (/["%!]/.test(path)) throw new Error('This path cannot be represented safely in Command Prompt');
    return `cd /d "${path}"`;
  }
  if (shell === 'powershell' || shell === 'pwsh') return `Set-Location -LiteralPath '${path.replace(/'/g, "''")}'`;
  return `cd -- '${path.replace(/'/g, "'\\''")}'`;
}

/** Keep complete trailing path segments instead of splitting a directory name. */
export function directoryLabel(path: string): string {
  if (path.length <= 28) return path;
  const parts = path.split('/').filter(Boolean);
  const tail = parts.pop() ?? path;
  const parent = parts.pop();
  return parent && parent.length + tail.length <= 26 ? `…/${parent}/${tail}` : `…/${tail}`;
}
