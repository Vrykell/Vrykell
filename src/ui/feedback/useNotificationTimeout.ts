import { useEffect, useRef, useState } from 'react';

/** Retain the remaining reading time while a notification is being inspected. */
export function useNotificationTimeout(identity: string, durationMs: number, paused: boolean, onExpire: () => void) {
  const expire = useRef(onExpire);
  expire.current = onExpire;
  const budget = useRef({ identity, durationMs, remaining: durationMs });
  const [background, setBackground] = useState(document.hidden);
  useEffect(() => {
    if (durationMs <= 0) return;
    const update = () => setBackground(document.hidden);
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, [durationMs]);
  useEffect(() => {
    if (budget.current.identity !== identity || budget.current.durationMs !== durationMs) {
      budget.current = { identity, durationMs, remaining: durationMs };
    }
    if (durationMs <= 0 || paused || background) return;
    const started = performance.now();
    const timer = setTimeout(() => expire.current(), Math.max(0, budget.current.remaining));
    return () => {
      clearTimeout(timer);
      budget.current.remaining = Math.max(0, budget.current.remaining - (performance.now() - started));
    };
  }, [identity, durationMs, paused, background]);
}
