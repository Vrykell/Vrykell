import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readClipboardFiles, writeClipboardFiles, writeClipboardText } from '@platform/clipboard';

const nativeWriteText = vi.hoisted(() => vi.fn());
const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: nativeWriteText,
}));

vi.mock('@platform/diagnostics', () => ({ invoke: invokeMock }));

describe('writeClipboardText', () => {
  beforeEach(() => {
    nativeWriteText.mockReset().mockResolvedValue(undefined);
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the native Tauri clipboard on desktop runtimes', async () => {
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};

    await writeClipboardText('echo linux');

    expect(nativeWriteText).toHaveBeenCalledWith('echo linux', { label: 'Vrykell command block' });
  });

  it('uses the browser clipboard when running outside Tauri', async () => {
    const writeText = navigator.clipboard.writeText as ReturnType<typeof vi.fn>;

    await writeClipboardText('output');

    expect(writeText).toHaveBeenCalledWith('output');
  });

  it('falls back to the browser clipboard when the native command is rejected', async () => {
    const writeText = navigator.clipboard.writeText as ReturnType<typeof vi.fn>;
    nativeWriteText.mockRejectedValueOnce(new Error('permission denied'));
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};

    await writeClipboardText('native fallback');

    expect(nativeWriteText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith('native fallback');
  });

  it('falls back to a user-gesture copy command when the browser API is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });

    await writeClipboardText('fallback');

    expect(execCommand).toHaveBeenCalledWith('copy');
  });
});

describe('file clipboard', () => {
  beforeEach(() => {
    invokeMock.mockReset().mockResolvedValue(undefined);
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('writes the real paths with their copy/cut intent on desktop', async () => {
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};

    await writeClipboardFiles(['/a', '/b'], 'cut');

    expect(invokeMock).toHaveBeenCalledWith('clipboard_write_files', { paths: ['/a', '/b'], mode: 'cut' });
  });

  it('is a no-op outside the desktop runtime', async () => {
    await writeClipboardFiles(['/a'], 'copy');

    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('reads the system file list on desktop and nothing otherwise', async () => {
    await expect(readClipboardFiles()).resolves.toEqual([]);

    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
    invokeMock.mockResolvedValue(['/a']);

    await expect(readClipboardFiles()).resolves.toEqual(['/a']);
    expect(invokeMock).toHaveBeenCalledWith('clipboard_read_files');
  });
});
