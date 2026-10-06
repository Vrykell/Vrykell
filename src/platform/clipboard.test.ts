import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readClipboardFiles, readClipboardText, writeClipboardFiles, writeClipboardText } from '@platform/clipboard';

const nativeWriteText = vi.hoisted(() => vi.fn());
const nativeReadText = vi.hoisted(() => vi.fn());
const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: nativeWriteText,
  readText: nativeReadText,
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

describe('readClipboardText', () => {
  beforeEach(() => {
    nativeReadText.mockReset().mockResolvedValue('native value');
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: vi.fn().mockResolvedValue('browser value') },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads through the native Tauri clipboard on desktop runtimes', async () => {
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};

    await expect(readClipboardText()).resolves.toBe('native value');
    expect(nativeReadText).toHaveBeenCalledOnce();
  });

  it('uses the browser clipboard outside Tauri', async () => {
    await expect(readClipboardText()).resolves.toBe('browser value');
    expect(nativeReadText).not.toHaveBeenCalled();
  });

  it('falls back to the browser clipboard when the native read is rejected', async () => {
    nativeReadText.mockRejectedValueOnce(new Error('permission denied'));
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};

    await expect(readClipboardText()).resolves.toBe('browser value');
    expect(nativeReadText).toHaveBeenCalledOnce();
  });

  it('returns an empty string when no clipboard API is available', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });

    await expect(readClipboardText()).resolves.toBe('');
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
