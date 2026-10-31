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

  it('offers the preferred editor on file rows of both panels', () => {
    const local = filePanelConfigFor({ kind: 'local' });
    const ssh = filePanelConfigFor({ kind: 'ssh', connectionId: 'c1' });

    expect(local.menus.rowFile).toContain('open-editor');
    expect(ssh.menus.rowFile).toContain('open-editor');
  });

  it('offers properties on single rows of both panels and routes path bar files per target', () => {
    const local = filePanelConfigFor({ kind: 'local' });
    const ssh = filePanelConfigFor({ kind: 'ssh', connectionId: 'c1' });

    expect(local.menus.rowFile).toContain('properties');
    expect(local.menus.rowFolder).toContain('properties');
    expect(ssh.menus.rowFile).toContain('properties');
    expect(ssh.menus.rowFolder).toContain('properties');
    // Multi-selection shows no properties entry: there is no single entry to describe.
    expect(local.menus.rowMulti).not.toContain('properties');
    expect(ssh.menus.rowMulti).not.toContain('properties');

    expect(local.pathBarFile).toBe('editor');
    expect(ssh.pathBarFile).toBe('editor');
  });

  it('offers everything the overflow menu does when right-clicking the blank area', () => {
    const local = filePanelConfigFor({ kind: 'local' });
    const ssh = filePanelConfigFor({ kind: 'ssh', connectionId: 'c1' });

    for (const config of [local, ssh]) {
      expect(config.menus.blank).toEqual(expect.arrayContaining(config.menus.more));
    }
    // The blank area adds paste (targeting the current directory); local panels also add new tab from the current folder
    expect(local.menus.blank).toEqual(expect.arrayContaining(['paste', 'new-tab-here']));
    expect(ssh.menus.blank).toEqual(expect.arrayContaining(['paste', 'upload-file', 'upload-dir']));
  });

  it('offers refresh in both panel-level menus of both panels, but not in the row menus', () => {
    const local = filePanelConfigFor({ kind: 'local' });
    const ssh = filePanelConfigFor({ kind: 'ssh', connectionId: 'c1' });

    for (const config of [local, ssh]) {
      expect(config.menus.more).toContain('refresh');
      expect(config.menus.blank).toContain('refresh');
      expect(config.menus.rowFile).not.toContain('refresh');
      expect(config.menus.rowFolder).not.toContain('refresh');
      expect(config.menus.rowMulti).not.toContain('refresh');
    }
  });
});
