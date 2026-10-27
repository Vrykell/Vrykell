export { default as UploadManager } from '@features/files/components/UploadManager';
/** Public entry point of the files domain. */
export { default as DownloadManager } from '@features/files/components/DownloadManager';
export { useFileDragStore } from '@features/files/stores/fileDrag';
export type { FileDragState } from '@features/files/stores/fileDrag';
export { fileOpsFor } from './model/fileOps';
export type { FileOps, FileOpsTarget } from './model/fileOps';
export { fileIcon } from './utils/fileIcon';
export { openFile, loadConfig as loadFileOpenConfig, remoteOpenCommand } from './services/fileOpen';
export { openPreferredFile } from './services/openPreferredFile';
export { openInTerminal } from './services/openInTerminal';
