export const EDITOR_ENCODINGS = { utf8: 'UTF-8', utf8bom: 'UTF-8 BOM', utf16le: 'UTF-16 LE', utf16be: 'UTF-16 BE', gb18030: 'GB18030', gbk: 'GBK', big5: 'Big5', windows1252: 'Windows-1252' } as const;
export type EditorEncoding = keyof typeof EDITOR_ENCODINGS;
export interface EditorVimCommand { action: 'write' | 'quit' | 'writeQuit' | 'exit' | 'reload' | 'next' | 'previous' | 'delete'; force: boolean; args: string; ranged: boolean }
export interface EditorFile { path: string; connectionId?: string; draftId?: string; encoding?: EditorEncoding }
export const editorFileKey = (file: EditorFile) => JSON.stringify(file.draftId ? ['draft', file.draftId] : [file.connectionId ?? '', file.path]);
export interface EditorContent { kind: 'text' | 'binary' | 'tooLarge'; text: string; revision: string; readOnly?: boolean; permissionDenied?: boolean; encoding?: EditorEncoding }

type CloseGuard = (files: EditorFile[], complete: () => void) => boolean;
let closeGuard: CloseGuard | undefined;
export function registerEditorCloseGuard(guard: CloseGuard) { closeGuard = guard; return () => { if (closeGuard === guard) closeGuard = undefined; }; }
export function interceptEditorClose(files: EditorFile[], complete: () => void) { return closeGuard?.(files, complete) ?? false; }
