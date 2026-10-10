import { describe, expect, it } from 'vitest';
import { directoryCommand, directoryLabel } from '../model/directoryCommand';

describe('directory commands', () => {
  it('quotes literal paths for POSIX, PowerShell, and Command Prompt', () => {
    expect(directoryCommand("/work/it's $HOME `pwd`", 'bash')).toBe("cd -- '/work/it'\\''s $HOME `pwd`'");
    expect(directoryCommand("C:/it's $HOME", 'pwsh')).toBe("Set-Location -LiteralPath 'C:/it''s $HOME'");
    expect(directoryCommand('D:/my workspace', 'cmd')).toBe('cd /d "D:/my workspace"');
    expect(() => directoryCommand('/work\nother')).toThrow();
    expect(() => directoryCommand('C:/%HOME%', 'cmd')).toThrow();
  });
  it('retains complete trailing directory names in compact labels', () => {
    expect(directoryLabel('~')).toBe('~');
    expect(directoryLabel('/Users/person/very-long-project-parent/project')).toBe('…/project');
    expect(directoryLabel('/Users/person/deep/nested/workspace')).toBe('…/nested/workspace');
  });
});
