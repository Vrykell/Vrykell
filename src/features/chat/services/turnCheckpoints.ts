import { create } from 'zustand';
import { invoke } from '@platform/diagnostics';

interface Checkpoint {
  key: string;
  files: string[];
}
export const useTurnCheckpoints = create<{ byQuestion: Record<string, Checkpoint> }>(() => ({ byQuestion: {} }));

export function captureTurn(questionId: string, cwd: string) {
  const key = crypto.randomUUID();
  useTurnCheckpoints.setState((state) => {
    if (!state.byQuestion[questionId]) return state;
    const byQuestion = { ...state.byQuestion };
    delete byQuestion[questionId];
    return { byQuestion };
  });
  const ready = invoke<boolean>('begin_turn_checkpoint', { key, cwd }).catch(() => false);
  let finishing: Promise<void> | undefined;
  const finish = (discard = false) =>
    (finishing ??= ready.then(async (started) => {
      if (!started) return;
      const files = await invoke<string[]>('finish_turn_checkpoint', { key, discard }).catch(() => []);
      if (files?.length)
        useTurnCheckpoints.setState((state) => ({
          byQuestion: { ...state.byQuestion, [questionId]: { key, files } },
        }));
    }));
  return { ready, finish };
}

export async function restoreTurn(questionId: string) {
  const checkpoint = useTurnCheckpoints.getState().byQuestion[questionId];
  if (!checkpoint) return;
  await invoke<void>('restore_turn_checkpoint', { key: checkpoint.key });
  useTurnCheckpoints.setState((state) => {
    const byQuestion = { ...state.byQuestion };
    delete byQuestion[questionId];
    return { byQuestion };
  });
}
