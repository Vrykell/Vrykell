/**
 * tools/index — buildTools assembly and deny filtering tests.
 */
import { describe, it, expect } from 'vitest';
import { buildTools, shellFamilyForPane } from '@features/agent/tools/index';
import { usePermissions } from '@features/agent/stores/permissions';

describe('buildTools', () => {
  it('registers core tools by default and skips tools at deny level', () => {
    usePermissions.setState({ levels: { run_command: 'deny', read_file: 'allow', web_search: 'deny' }, mode: 'standard' });
    const tools = buildTools({});
    expect(tools.run_command).toBeUndefined();
    expect(tools.read_file).toBeDefined();
    expect(tools.web_search).toBeUndefined();
    expect(tools.read_terminal).toBeDefined();
    expect(tools.use_skill).toBeDefined();
    expect(tools.install_skill).toBeDefined();
    expect(tools.memory).toBeDefined();
    expect(tools.schedule).toBeUndefined();
    expect(tools.subagent).toBeUndefined();
  });
});

describe('shellFamilyForPane', () => {
  it('treats a local pane with the default "system" shell as Windows on Windows', () => {
    // The pane has no shellType (the "system" preference chosen at creation); on Windows it is still PowerShell/cmd
    expect(shellFamilyForPane({ kind: 'local' }, true)).toBe('powershell');
    expect(shellFamilyForPane(undefined, true)).toBe('powershell');
    // Other platforms still follow POSIX rules
    expect(shellFamilyForPane({ kind: 'local' }, false)).toBe('posix');
  });

  it('follows per-shell rules when the shell is explicit or the pane is remote', () => {
    expect(shellFamilyForPane({ kind: 'local', shellType: 'bash' }, true)).toBe('bash');
    expect(shellFamilyForPane({ kind: 'local', shellType: 'cmd' }, false)).toBe('cmd');
    // The SSH remote is a POSIX shell and is unaffected by the local platform
    expect(shellFamilyForPane({ kind: 'ssh' }, true)).toBe('posix');
  });
});
