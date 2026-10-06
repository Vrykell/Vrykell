import { describe, expect, it } from 'vitest';
import { filePanelConfigFor } from '@features/files/model/filePanelConfig';

describe('filePanelConfig menus', () => {
  it('offers new file and new folder in the overflow menu for both panels', () => {
    const local = filePanelConfigFor({ kind: 'local' });
    const ssh = filePanelConfigFor({ kind: 'ssh', connectionId: 'c1' });

    expect(local.menus.more).toEqual(expect.arrayContaining(['new-file', 'new-folder']));
    expect(ssh.menus.more).toEqual(expect.arrayContaining(['new-file', 'new-folder']));
  });

  it('offers reveal on local rows and the overflow menu, but not for remote targets', () => {
    const local = filePanelConfigFor({ kind: 'local' });
    const ssh = filePanelConfigFor({ kind: 'ssh', connectionId: 'c1' });

    expect(local.menus.rowFile).toContain('reveal');
    expect(local.menus.rowFolder).toContain('reveal');
    expect(local.menus.more).toContain('reveal');

    expect(ssh.menus.rowFile).not.toContain('reveal');
    expect(ssh.menus.rowFolder).not.toContain('reveal');
    expect(ssh.menus.more).not.toContain('reveal');
  });
});
