import { describe, expect, it } from 'vitest';
import { formatCommandSubmission, posixScriptCommand } from '../model/commandSubmission';

describe('script submission', () => {
  it('leaves ordinary commands and explicit blank Enter submissions unchanged', () => {
    expect(formatCommandSubmission('git status', 'posix')).toBe('git status\n');
    expect(formatCommandSubmission('echo hi\n', 'powershell')).toBe('echo hi\n');
    expect(formatCommandSubmission('\n\n\n', 'posix')).toBe('\n\n\n');
  });

  it('keeps heredoc delimiters, indentation, blank lines and quotes in one physical input line', () => {
    const script = "cat <<'TEXT'\r\n  '$HOME' \\ path\r\n\r\nTEXT\r\nprintf '%s' \"done\"";
    const payload = formatCommandSubmission(script, 'posix');
    expect(payload.trimEnd()).not.toMatch(/[\r\n]/);
    expect(payload).toContain("'cat <<'\\''TEXT'\\''' '  '\\''$HOME'\\'' \\ path' '' 'TEXT'");
    expect(payload).toContain("'printf '\\''%s'\\'' \"done\"'");
  });

  it('treats script lines beginning with options as printf data', () => {
    expect(posixScriptCommand('-n\n--flag')).toBe('eval "$(printf \'%s\\n\' \'-n\' \'--flag\')"');
  });

  it('transports Unicode and multiline expressions without interpolation by the line editor', () => {
    const script = "$value = '中文 😀'\nWrite-Output $value";
    const payload = formatCommandSubmission(script, 'powershell');
    expect(payload.trimEnd()).not.toMatch(/[\r\n]/);
    const encoded = /FromBase64String\('([^']+)'\)/.exec(payload)![1]!;
    expect(new TextDecoder().decode(Uint8Array.from(atob(encoded), char => char.charCodeAt(0)))).toBe(script);
  });
});
