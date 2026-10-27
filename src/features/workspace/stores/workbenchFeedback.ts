import { create } from 'zustand';

interface WorkbenchFailure { error: unknown; retry: () => void }
export const useWorkbenchFeedback = create<{ failure: WorkbenchFailure | null }>(() => ({ failure: null }));

export function reportWorkbenchFailure(error: unknown, retry: () => void) {
  useWorkbenchFeedback.setState({ failure: { error, retry } });
}
