import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useSettingsSave } from '../components/SettingsSaveProvider';
import { t } from '@i18n';
import { terminalDebug } from '@features/terminal/services/terminalDebug';
import { useToastStore } from '@ui/feedback/Toast';

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

/** Debounce text edits and serialize writes without discarding newer drafts. */
export function useAutoSave<Value>(initialValue: Value, onSave: (value: Value) => void | Promise<void>, validate?: (value: Value) => string | undefined, resetAfterSave?: Value, normalize?: (value: Value) => Value) {
  const [value, setDraft] = useState(initialValue);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState('');
  const id = useId();
  const { report: reportFeedback } = useSettingsSave();
  const callbacks = useRef({ onSave, validate, resetAfterSave, normalize });
  callbacks.current = { onSave, validate, resetAfterSave, normalize };
  const state = useRef({ value: initialValue, dirty: false, version: 0, mounted: true,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    running: undefined as Promise<void> | undefined, requested: false, composing: false,
    callbacks: { onSave, validate, resetAfterSave, normalize } });

  const report = (next: SaveStatus, message = '') => {
    if (state.current.mounted) { setStatus(next); setError(message); }
  };
  const flush = useCallback((): Promise<void> => {
    const current = state.current;
    clearTimeout(current.timer);
    current.timer = undefined;
    if (current.composing) return current.running ?? Promise.resolve();
    if (!current.dirty) return current.running ?? Promise.resolve();
    current.requested = true;
    if (current.running) return current.running;
    const run = async () => {
      while (current.requested && current.dirty) {
        current.requested = false;
        const { value: snapshot, version, callbacks: captured } = current;
        const invalid = captured.validate?.(snapshot);
        if (invalid) { report('error', invalid); break; }
        const committed = captured.normalize ? captured.normalize(snapshot) : snapshot;
        report('saving');
        terminalDebug('settings-save-start', { revision: version });
        try {
          await captured.onSave(committed);
          terminalDebug('settings-save-complete', { revision: version });
          if (current.version === version) {
            current.dirty = false;
            current.value = captured.resetAfterSave !== undefined ? captured.resetAfterSave : committed;
            if (current.mounted) setDraft(current.value);
            report('saved');
          }
          else report(current.dirty ? 'pending' : 'idle');
        } catch (cause) {
          terminalDebug('settings-save-failed', { revision: version, errorType: cause instanceof Error ? cause.name : typeof cause });
          if (current.version === version) {
            report('error', t('Save failed. Try again.'));
            if (!current.mounted) useToastStore.getState().addToast(t('Settings could not be saved. Reopen settings to check.'), 'error');
          }
        }
      }
    };
    // Start in a microtask so synchronous saves share the same serialization guard.
    current.running = Promise.resolve().then(run).finally(() => { current.running = undefined; });
    return current.running;
  }, []);

  const setValue = useCallback((next: Value | ((previous: Value) => Value), immediate = false, deferred = false) => {
    const current = state.current;
    const updated = typeof next === 'function' ? (next as (previous: Value) => Value)(current.value) : next;
    if (Object.is(updated, current.value) && !current.dirty) return;
    current.value = updated;
    current.version += 1;
    current.dirty = true;
    current.callbacks = callbacks.current;
    setDraft(updated);
    report('pending');
    clearTimeout(current.timer);
    if (deferred || current.composing) return;
    if (immediate) void flush();
    else current.timer = setTimeout(() => { void flush(); }, 600);
  }, [flush]);

  const setComposing = useCallback((composing: boolean) => {
    const current = state.current;
    current.composing = composing;
    clearTimeout(current.timer);
    if (!composing && current.dirty) current.timer = setTimeout(() => { void flush(); }, 600);
  }, [flush]);

  const cancel = useCallback(() => {
    const current = state.current;
    clearTimeout(current.timer);
    current.dirty = false;
    current.requested = false;
    current.version += 1;
    report('idle');
    return current.running ?? Promise.resolve();
  }, []);

  const reset = useCallback((next: Value) => {
    state.current.value = next;
    state.current.dirty = false;
    state.current.version += 1;
    setDraft(next);
    report('saved');
  }, []);

  useEffect(() => {
    if (!state.current.dirty && !state.current.running) {
      state.current.value = initialValue;
      setDraft(initialValue);
    }
  }, [initialValue]);
  useEffect(() => {
    state.current.mounted = true;
    return () => { state.current.mounted = false; state.current.composing = false; void flush(); };
  }, [flush]);

  useEffect(() => { reportFeedback?.(id, { status, retry: () => { void flush(); } }); }, [id, status, flush, reportFeedback]);
  useEffect(() => () => { reportFeedback?.(id, null); }, [id, reportFeedback]);
  return { value, setValue, status, error, flush, cancel, reset, setComposing, hasPending: () => state.current.dirty };
}
