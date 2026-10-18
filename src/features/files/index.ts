export { default as UploadManager } from '@features/files/components/UploadManager';
/** 文件领域公开入口。 */
export { default as DownloadManager } from '@features/files/components/DownloadManager';
export { useFileDragStore } from '@features/files/stores/fileDrag';
export type { FileDragState } from '@features/files/stores/fileDrag';
export { fileOpsFor } from './model/fileOps';
export type { FileOps, FileOpsTarget } from './model/fileOps';
