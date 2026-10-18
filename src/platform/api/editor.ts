import { invoke } from '@tauri-apps/api/core';
import type { EditorFile, EditorContent } from '@core/editor';
import { diagnostic } from '@platform/diagnostics';
async function request<T>(operation: string, action: () => Promise<T>): Promise<T> {
  diagnostic('editor-request', { operation, stage: 'start' });
  try { const result = await action(); diagnostic('editor-request', { operation, stage: 'complete' }); return result; }
  catch (reason) { diagnostic('editor-request', { operation, stage: 'error' }, 'error'); throw reason; }
}
export const readEditorFile = (target: EditorFile): Promise<EditorContent> => request('read', () => invoke('editor_read_file', { target }));
export const saveEditorFile = (target: EditorFile, text: string, expected: string): Promise<string> => request('save', () => invoke('editor_save_file', { target, text, expected }));
