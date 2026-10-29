import { create } from 'zustand';

export interface FileOpenFailure {
  details: string;
  retry: () => void;
}

export const useFileOpenFailure = create<{ failure: FileOpenFailure | null }>(() => ({ failure: null }));
