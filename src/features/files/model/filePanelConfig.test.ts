import { describe, expect, it } from 'vitest';
import { filePanelConfigFor } from '@features/files/model/filePanelConfig';

describe('filePanelConfig more menu', () => {
  it('offers new file and new folder in the overflow menu for both panels', () => {
    const local = filePanelConfigFor({ kind: 'local' });
    const ssh = filePanelConfigFor({ kind: 'ssh', connectionId: 'c1' });

    expect(local.menus.more).toEqual(expect.arrayContaining(['new-file', 'new-folder']));
    expect(ssh.menus.more).toEqual(expect.arrayContaining(['new-file', 'new-folder']));
  });
});
