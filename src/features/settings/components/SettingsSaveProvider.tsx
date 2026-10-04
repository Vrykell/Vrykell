import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import type { SaveStatus } from '../hooks/useAutoSave';
import { terminalDebug } from '@features/terminal/services/terminalDebug';

type Save = (operation: () => void | Promise<void>) => Promise<void>;
const fallback: Save = async operation => { await operation(); };
const Context = createContext<{ save: Save; status: SaveStatus; retry: () => void }>({ save: fallback, status: 'idle', retry: () => {} });

export function SettingsSaveProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const revision = useRef(0);
  const failed = useRef<(() => void | Promise<void>) | null>(null);
  const save: Save = useCallback(async operation => {
    const current = ++revision.current;
    failed.current = null;
    setStatus('saving');
    terminalDebug('settings-choice-save-start', { revision: current });
    try {
      await operation();
      if (current === revision.current) setStatus('saved');
      terminalDebug('settings-choice-save-complete', { revision: current });
    } catch (cause) {
      if (current === revision.current) { failed.current = operation; setStatus('error'); }
      terminalDebug('settings-choice-save-failed', { revision: current, errorType: cause instanceof Error ? cause.name : typeof cause });
    }
  }, []);
  const retry = () => { if (failed.current) void save(failed.current); };
  return <Context.Provider value={{ save, status, retry }}>{children}</Context.Provider>;
}

export const useSettingsSave = () => useContext(Context);
