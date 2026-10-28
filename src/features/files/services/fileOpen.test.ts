import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openPath: vi.fn(() => Promise.resolve()) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { openPath } from '@tauri-apps/plugin-opener';
import {
  parseTemplatesText,
  serializeTemplates,
  openFile,
  loadConfig,
  saveConfig,
  SYSTEM_DEFAULT,
  DEFAULT_CONFIG,
  remoteOpenCommand,
  type FileOpenConfig,
} from '@features/files/services/fileOpen';

const cfg = (over: Partial<FileOpenConfig> = {}): FileOpenConfig => ({
  defaultEditor: 'vim',
  templates: {},
  remoteEditor: 'vim',
  remoteTemplates: {},
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('template text parsing/serialization', () => {
  it('quotes every remote file placeholder and refuses control characters', () => {
    const config = cfg({ remoteTemplates: { txt: 'diff {file} {file}' } });
    expect(remoteOpenCommand(config, "/tmp/it's.txt")).toBe("diff '/tmp/it'\\''s.txt' '/tmp/it'\\''s.txt'\n");
    expect(() => remoteOpenCommand(config, '/tmp/\x15echo unsafe\r#')).toThrow();
  });
  it('each line is ext=command, comments and blank lines are ignored', () => {
    const t = parseTemplatesText('md=code\n# 注释\n\n.PNG=__system__\n坏行\n=log');
    expect(t).toEqual({ md: 'code', png: SYSTEM_DEFAULT });
  });
  it('serialization roundtrip', () => {
    const t = { md: 'code', png: SYSTEM_DEFAULT };
    expect(parseTemplatesText(serializeTemplates(t))).toEqual(t);
  });
});

describe('openFile (policy lives in Rust, the frontend only performs side effects)', () => {
  it('passes the selected terminal shell to command construction', async () => {
    invokeMock.mockResolvedValue({ via: 'terminal', editor: 'vim', command: "vim 'C:/a''b.txt'", fellBack: false });
    const write = vi.fn();
    await openFile("C:/a'b.txt", write, 'pwsh');
    expect(invokeMock).toHaveBeenCalledWith('file_open', { path: "C:/a'b.txt", cfg: { ...cfg(), shell: 'pwsh' } });
    expect(write).toHaveBeenCalledWith("vim 'C:/a''b.txt'");
  });
  it('Rust returns terminal → writes the command', async () => {
    invokeMock.mockResolvedValue({
      via: 'terminal',
      editor: 'vim',
      command: "vim '/tmp/a.md'",
      fellBack: false,
    });
    const write = vi.fn();
    const r = await openFile('/tmp/a.md', write);
    expect(invokeMock).toHaveBeenCalledWith('file_open', { path: '/tmp/a.md', cfg: cfg() });
    expect(write).toHaveBeenCalledWith("vim '/tmp/a.md'");
    expect(r).toEqual({ via: 'terminal', editor: 'vim', fellBack: false });
  });

  it('Rust returns terminal fellBack → marks degradation', async () => {
    invokeMock.mockResolvedValue({
      via: 'terminal',
      editor: 'nano',
      command: "nano '/tmp/a.txt'",
      fellBack: true,
    });
    const r = await openFile('/tmp/a.txt', vi.fn());
    expect(r).toEqual({ via: 'terminal', editor: 'nano', fellBack: true });
  });

  it('Rust returns system → openPath without degradation', async () => {
    invokeMock.mockResolvedValue({ via: 'system', degraded: false });
    const r = await openFile('/tmp/a.png', vi.fn());
    expect(openPath).toHaveBeenCalledWith('/tmp/a.png');
    expect(r).toEqual({ via: 'system', degraded: false });
  });

  it('Rust returns system degraded → openPath and marks degradation', async () => {
    invokeMock.mockResolvedValue({ via: 'system', degraded: true });
    const r = await openFile('/tmp/a.txt', vi.fn());
    expect(r).toEqual({ via: 'system', degraded: true });
  });
});

describe('config read/write', () => {
  it('returns the default config when storage is empty', () => {
    expect(loadConfig()).toEqual(DEFAULT_CONFIG);
  });
  it('returns the default config for corrupt JSON', () => {
    localStorage.setItem('vrykell-file-open', '{bad');
    expect(loadConfig()).toEqual(DEFAULT_CONFIG);
  });
  it('falls back to vim when defaultEditor is empty', () => {
    localStorage.setItem('vrykell-file-open', JSON.stringify({ defaultEditor: '  ', templates: { md: 'code' } }));
    expect(loadConfig()).toEqual({ defaultEditor: 'vim', templates: { md: 'code' }, remoteEditor: 'vim', remoteTemplates: {} });
  });
  it('save/load roundtrip', () => {
    const c = cfg({ defaultEditor: 'emacs', templates: { rs: 'nvim' } });
    expect(saveConfig(c)).toBe(true);
    expect(loadConfig()).toEqual(c);
  });
  it('reports a failed storage write instead of claiming a successful save', () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('quota'); });
    expect(saveConfig(cfg())).toBe(false);
    storage.mockRestore();
  });
});
