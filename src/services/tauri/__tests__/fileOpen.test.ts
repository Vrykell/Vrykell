import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openPath: vi.fn(() => Promise.resolve()) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { openPath } from '@tauri-apps/plugin-opener';
import {
  DEFAULT_CONFIG,
  type FileOpenConfig,
  loadConfig,
  openFile,
  parseTemplatesText,
  SYSTEM_DEFAULT,
  saveConfig,
  serializeTemplates,
} from '@/features/files/services/fileOpen';

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

describe('模板文本解析/序列化', () => {
  it('每行 ext=命令，忽略注释和空行', () => {
    const t = parseTemplatesText('md=code\n# 注释\n\n.PNG=__system__\n坏行\n=log');
    expect(t).toEqual({ md: 'code', png: SYSTEM_DEFAULT });
  });
  it('序列化往返', () => {
    const t = { md: 'code', png: SYSTEM_DEFAULT };
    expect(parseTemplatesText(serializeTemplates(t))).toEqual(t);
  });
});

describe('openFile（策略在 Rust，前端只做副作用）', () => {
  it('Rust 返回 terminal → 写命令', async () => {
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

  it('Rust 返回 terminal fellBack → 标记降级', async () => {
    invokeMock.mockResolvedValue({
      via: 'terminal',
      editor: 'nano',
      command: "nano '/tmp/a.txt'",
      fellBack: true,
    });
    const r = await openFile('/tmp/a.txt', vi.fn());
    expect(r).toEqual({ via: 'terminal', editor: 'nano', fellBack: true });
  });

  it('Rust 返回 system → openPath 且非降级', async () => {
    invokeMock.mockResolvedValue({ via: 'system', degraded: false });
    const r = await openFile('/tmp/a.png', vi.fn());
    expect(openPath).toHaveBeenCalledWith('/tmp/a.png');
    expect(r).toEqual({ via: 'system', degraded: false });
  });

  it('Rust 返回 system degraded → openPath 且标记降级', async () => {
    invokeMock.mockResolvedValue({ via: 'system', degraded: true });
    const r = await openFile('/tmp/a.txt', vi.fn());
    expect(r).toEqual({ via: 'system', degraded: true });
  });
});

describe('配置读写', () => {
  it('无存储时返回默认配置', () => {
    expect(loadConfig()).toEqual(DEFAULT_CONFIG);
  });
  it('损坏 JSON 返回默认配置', () => {
    localStorage.setItem('vrykell-file-open', '{bad');
    expect(loadConfig()).toEqual(DEFAULT_CONFIG);
  });
  it('空 defaultEditor 回退 vim', () => {
    localStorage.setItem(
      'vrykell-file-open',
      JSON.stringify({ defaultEditor: '  ', templates: { md: 'code' } }),
    );
    expect(loadConfig()).toEqual({
      defaultEditor: 'vim',
      templates: { md: 'code' },
      remoteEditor: 'vim',
      remoteTemplates: {},
    });
  });
  it('save/load 往返', () => {
    const c = cfg({ defaultEditor: 'emacs', templates: { rs: 'nvim' } });
    saveConfig(c);
    expect(loadConfig()).toEqual(c);
  });
});
