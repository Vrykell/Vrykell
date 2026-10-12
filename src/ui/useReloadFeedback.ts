import { useEffect, useRef, useState } from 'react';

/** Keep reload feedback visible for one turn, and longer while work is pending. */
export function useReloadFeedback(action: () => void | Promise<void>) {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimeout(timer.current); };
  }, []);

  const run = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    const started = Date.now();
    try {
      await action();
    } finally {
      if (mounted.current) {
        timer.current = setTimeout(() => {
          pending.current = false;
          setBusy(false);
        }, Math.max(0, 800 - (Date.now() - started)));
      }
    }
  };
  return { busy, run };
}
