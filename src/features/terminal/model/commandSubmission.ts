export type CommandShell = 'posix' | 'powershell' | 'cmd';

const POWERSHELL_WRAPPER = /^Invoke-Expression \(\[System\.Text\.Encoding\]::UTF8\.GetString\(\[System\.Convert\]::FromBase64String\('([A-Za-z0-9+/=]*)'\)\)\)$/;

/** Reconstruct the complete script only after the line editor accepts one physical line. */
export function posixScriptCommand(script: string): string {
  const lines = script.replace(/\r\n|\r/g, '\n').split('\n');
  const quoted = lines.map(line => `'${line.replace(/'/g, "'\\''")}'`).join(' ');
  return `eval "$(printf '%s\\n' ${quoted})"`;
}

/** Decode the one-line PowerShell transport back into the submitted script, or null. */
export function decodePowerShellSubmission(command: string): string | null {
  const match = POWERSHELL_WRAPPER.exec(command.trim());
  if (!match) return null;
  try {
    const binary = atob(match[1]!);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Multiline submissions preserve shell state and keep script bytes out of terminal key handling. */
export function formatCommandSubmission(command: string, shell: CommandShell): string {
  const normalized = command.replace(/\r\n|\r/g, '\n');
  let source = normalized;
  if (normalized.trimEnd().includes('\n') && normalized.trim()) {
    if (shell === 'posix') source = posixScriptCommand(normalized);
    else if (shell === 'powershell') {
      const bytes = new TextEncoder().encode(normalized);
      const encoded = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
      source = `Invoke-Expression ([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encoded}')))`;
    }
  }
  return source.endsWith('\n') ? source : `${source}\n`;
}
