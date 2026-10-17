import { useCallback, useEffect, useRef } from 'react';
import { detachToolWindow, openToolWindow } from '@platform/toolWindows';

/** Keep action callbacks current while a minimized native tool retains its original draft. */
export function useToolWindow<T, A>({ key, title, kind, input, onAction, onError }: {
  key: string; title: string; kind: string; input: T; onAction: (action: A) => Promise<unknown>; onError: (reason: unknown) => void;
}) {
  const current = useRef({ input, onAction, onError }); current.current = { input, onAction, onError };
  useEffect(() => () => detachToolWindow(key), [key]);
  return useCallback(() => {
    void openToolWindow(key, title, { kind, input: current.current.input }, (action: A) => current.current.onAction(action))
      .catch(reason => current.current.onError(reason));
  }, [key, title, kind]);
}
