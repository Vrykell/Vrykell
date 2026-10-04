import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ask } from '@tauri-apps/plugin-dialog';
import { sshHostKeyInfo, sshTrustHostKey } from '../services/api';
import { prepareSshHost } from '../services/hostTrust';

vi.mock('@tauri-apps/plugin-dialog', () => ({ ask: vi.fn() }));
vi.mock('../services/api', () => ({ sshHostKeyInfo: vi.fn(), sshTrustHostKey: vi.fn() }));
const info = { known: false, fingerprint: 'SHA256:verified-key', keyType: 'ed25519' };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(sshHostKeyInfo).mockResolvedValue(info);
  vi.mocked(sshTrustHostKey).mockResolvedValue();
});

describe('SSH host trust', () => {
  it('connects to a known host without asking again', async () => {
    vi.mocked(sshHostKeyInfo).mockResolvedValue({ ...info, known: true });
    expect((await prepareSshHost('server', 2222)).known).toBe(true);
    expect(sshHostKeyInfo).toHaveBeenCalledWith('server', 2222);
    expect(ask).not.toHaveBeenCalled();
    expect(sshTrustHostKey).not.toHaveBeenCalled();
  });
  it('displays the fingerprint and records exactly the confirmed key', async () => {
    vi.mocked(ask).mockResolvedValue(true);
    await expect(prepareSshHost('server')).resolves.toEqual(info);
    expect(ask).toHaveBeenCalledWith(expect.stringContaining(info.fingerprint), expect.objectContaining({ okLabel: '信任并连接' }));
    expect(sshTrustHostKey).toHaveBeenCalledWith('server', undefined, info.fingerprint);
  });
  it('cancels without trusting the host', async () => {
    vi.mocked(ask).mockResolvedValue(false);
    await expect(prepareSshHost('server')).rejects.toThrow('已取消');
    expect(sshTrustHostKey).not.toHaveBeenCalled();
  });
  it('rejects a changed key without offering to overwrite it', async () => {
    vi.mocked(sshHostKeyInfo).mockRejectedValue(new Error('主机密钥不匹配'));
    await expect(prepareSshHost('server')).rejects.toThrow('主机密钥不匹配');
    expect(ask).not.toHaveBeenCalled();
    expect(sshTrustHostKey).not.toHaveBeenCalled();
  });
  it('does not trust a host after the pane closes during confirmation', async () => {
    const abort = new AbortController();
    vi.mocked(ask).mockImplementation(async () => { abort.abort(); return true; });
    await expect(prepareSshHost('server', 22, abort.signal)).rejects.toThrow();
    expect(sshTrustHostKey).not.toHaveBeenCalled();
  });
});
