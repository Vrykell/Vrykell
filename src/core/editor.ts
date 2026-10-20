export interface EditorFile { path: string; connectionId?: string }
export const editorFileKey = (file: EditorFile) => JSON.stringify([file.connectionId ?? '', file.path]);
export interface EditorContent { kind: 'text' | 'binary' | 'tooLarge'; text: string; revision: string; readOnly?: boolean; permissionDenied?: boolean }

type CloseGuard = (files: EditorFile[], complete: () => void) => boolean;
let closeGuard: CloseGuard | undefined;
export function registerEditorCloseGuard(guard: CloseGuard) { closeGuard = guard; return () => { if (closeGuard === guard) closeGuard = undefined; }; }
export function interceptEditorClose(files: EditorFile[], complete: () => void) { return closeGuard?.(files, complete) ?? false; }
