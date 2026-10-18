import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface FileUndoSettings {
  local: boolean;
  remote: boolean;
  update: (value: Partial<Pick<FileUndoSettings, 'local' | 'remote'>>) => void;
}

export const useFileUndoSettings = create<FileUndoSettings>()(persist(set => ({
  local: true,
  remote: true,
  update: value => set(value),
}), {
  name: 'vrykell-file-undo',
  partialize: ({ local, remote }) => ({ local, remote }),
  merge: (saved, current) => {
    const value = saved as Partial<FileUndoSettings> | null;
    return { ...current, local: value?.local !== false, remote: value?.remote !== false };
  },
}));
