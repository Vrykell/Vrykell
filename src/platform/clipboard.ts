import { writeText as writeNativeClipboardText } from '@tauri-apps/plugin-clipboard-manager';
import { invoke } from '@platform/diagnostics';

/** Write text through the native clipboard when running inside Tauri. */
export async function writeClipboardText(text: string): Promise<void> {
  const internals = (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  if (internals) {
    try {
      await writeNativeClipboardText(text, { label: 'Vrykell command block' });
      return;
    } catch {
      // Keep the browser fallbacks available when the native command is denied.
    }
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Permission or an unsupported webview can reject the asynchronous API.
    }
  }

  const focused = document.activeElement;
  const selection = window.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange())
    : [];
  const inputSelection = focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement
    ? { start: focused.selectionStart, end: focused.selectionEnd, direction: focused.selectionDirection }
    : null;
  const input = document.createElement('textarea');
  input.value = text;
  input.tabIndex = -1;
  input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.appendChild(input);
  try {
    input.select();
    if (!document.execCommand?.('copy')) throw new Error('Clipboard copy command was rejected');
  } finally {
    input.remove();
    if (focused instanceof HTMLElement && focused.isConnected) focused.focus({ preventScroll: true });
    if (inputSelection?.start != null && inputSelection.end != null
      && (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement)) {
      focused.setSelectionRange(inputSelection.start, inputSelection.end, inputSelection.direction ?? undefined);
    }
    if (selection) {
      selection.removeAllRanges();
      ranges.forEach((range) => selection.addRange(range));
    }
  }
}

/** True inside the desktop runtime (where the Tauri IPC bridge exists). */
function isDesktopRuntime(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

/**
 * Put the given real files on the system clipboard so they can be pasted into the OS file
 * manager. `mode` is "copy" or "cut" and only changes the advertised intent. No-op outside the
 * desktop runtime.
 */
export async function writeClipboardFiles(paths: string[], mode: 'copy' | 'cut'): Promise<void> {
  if (!isDesktopRuntime() || paths.length === 0) return;
  await invoke('clipboard_write_files', { paths, mode });
}

/** Read the file paths currently on the system clipboard (empty outside the desktop runtime). */
export async function readClipboardFiles(): Promise<string[]> {
  if (!isDesktopRuntime()) return [];
  return invoke<string[]>('clipboard_read_files');
}
