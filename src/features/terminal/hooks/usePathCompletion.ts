import { useEffect, useRef, useState, type RefObject } from 'react';
import { fileOpsFor } from '@features/files';
import { completeFilePath, isPathShapedToken, pathCompletionToken, type PathCompletion } from '@features/files/services/pathCompletion';
import { localCompleteCandidates } from '@features/agent/services/complete';
import { useSessionStore } from '@features/workspace';
import { leaves } from '@features/workspace/model/windowLayout';
import { completeShell, warmShellCompletion } from '@platform/api/completion';
import { terminalDebug } from '../services/terminalDebug';
import { resolveCompletion, type CompletionProvider } from '../services/completionArbiter';
import { useTerminalStore } from '../stores/terminal';

const WARM_INTERVAL_MS = 60_000;

/** PowerShell identifiers and CMD all need the resident PowerShell helper. */
function usesPowerShell(shell: string): boolean {
  return shell === 'powershell' || shell === 'pwsh' || shell === 'cmd';
}

export function usePathCompletion({ paneId, text, cwd, visible, isFocused, inputRef, setText }: {
  paneId: string; text: string; cwd?: string; visible: boolean; isFocused: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>; setText: (value: string) => void;
}) {
  const spec = useSessionStore(state => state.tabs.flatMap(tab => tab.kind === 'session' ? leaves(tab.layout) : []).find(pane => pane.id === paneId));
  const connectionId = spec?.kind === 'ssh' ? spec.ssh?.connectionId : undefined;
  const remote = spec?.kind === 'ssh';
  const runningShell = useTerminalStore(state => state.shellTypes?.[paneId]);
  const shell = remote ? undefined : runningShell ?? spec?.shellType;
  const cycle = useRef<{ base: string; cursor: number; candidates: PathCompletion[]; index: number; current: string } | null>(null);
  const sequence = useRef(0);
  const pending = useRef(false);
  const warmedAt = useRef<number | null>(null);
  const [ownsCompletion, setOwnsCompletion] = useState(false);
  const latest = useRef({ text, cwd, visible, isFocused, connectionId, shell });
  latest.current = { text, cwd, visible, isFocused, connectionId, shell };
  useEffect(() => {
    sequence.current++;
    pending.current = false;
    if (cycle.current?.current !== text) { cycle.current = null; setOwnsCompletion(false); }
  }, [text]);
  useEffect(() => { sequence.current++; cycle.current = null; pending.current = false; setOwnsCompletion(false); }, [cwd, connectionId, shell, visible, isFocused]);
  useEffect(() => () => { sequence.current++; }, []);
  useEffect(() => {
    if (!spec || remote || !visible || !isFocused || !text.trim() || !shell || !usesPowerShell(shell)) return;
    const now = performance.now();
    if (warmedAt.current !== null && now - warmedAt.current < WARM_INTERVAL_MS) return;
    warmedAt.current = now;
    // A failed warm is retried on the next input change instead of waiting out the interval.
    void warmShellCompletion(shell)
      .then(() => terminalDebug('completion-warm', { shell, elapsedMs: Math.round(performance.now() - now), ok: true }))
      .catch(() => {
        warmedAt.current = null;
        terminalDebug('completion-warm', { shell, elapsedMs: Math.round(performance.now() - now), ok: false });
      });
  }, [isFocused, remote, shell, spec, text, visible]);

  const apply = (candidate: PathCompletion) => {
    if (cycle.current) cycle.current.current = candidate.text;
    setText(candidate.text);
    requestAnimationFrame(() => { inputRef.current?.setSelectionRange(candidate.cursor, candidate.cursor); });
  };
  const acceptPathCompletion = (reverse: boolean) => {
    const input = inputRef.current;
    if (!visible || !isFocused || !input || input.selectionStart !== input.selectionEnd || remote && !connectionId) return false;
    // An empty draft has no prefix to complete; Tab must not insert the newest history command.
    if (!text.trim()) return false;
    const current = cycle.current;
    if (pending.current) return true;
    if (current && current.current === text) {
      current.index = (current.index + (reverse ? -1 : 1) + current.candidates.length) % current.candidates.length;
      apply(current.candidates[current.index]!); return true;
    }
    const cursor = input.selectionStart;
    const token = pathCompletionToken(text, cursor, shell);
    const started = performance.now();
    const request = ++sequence.current;
    pending.current = true; setOwnsCompletion(true);
    const context = latest.current;
    const ops = fileOpsFor(connectionId ? { kind: 'ssh', connectionId } : { kind: 'local' });
    const isCurrent = () => request === sequence.current && latest.current.text === text && latest.current.cwd === context.cwd
      && latest.current.connectionId === context.connectionId && latest.current.shell === context.shell
      && latest.current.visible && latest.current.isFocused && inputRef.current === input
      && document.activeElement === input && input.selectionStart === cursor && input.selectionEnd === cursor;
    // One applicable route per attempt: obvious paths never start a shell process, command words
    // never wait for a directory listing, and local bare arguments try the shell before paths.
    // History stays the first tier.
    const providers: CompletionProvider<PathCompletion>[] = [];
    const suffixes = !text.includes('\n') && cursor === text.length
      ? localCompleteCandidates(text).filter(suffix => !/[\r\n]/.test(suffix))
      : [];
    if (suffixes.length) {
      providers.push({ id: 'builtin', complete: () => Promise.resolve(suffixes.map(suffix => ({ text: text + suffix, cursor: text.length + suffix.length }))) });
    } else if (token && (isPathShapedToken(token) || remote)) {
      providers.push({ id: 'path', complete: () => completeFilePath(text, cursor, token, cwd, ops) });
    } else if (!remote && !text.includes('\n')) {
      providers.push({ id: 'shell', complete: () => completeShell(text, cursor, cwd, shell) });
      if (token) providers.push({ id: 'path', complete: () => completeFilePath(text, cursor, token, cwd, ops) });
    }
    void resolveCompletion<PathCompletion>(providers, isCurrent).then(result => {
      if (!isCurrent()) {
        if (request === sequence.current) { pending.current = false; setOwnsCompletion(false); }
        return;
      }
      pending.current = false;
      if (!result) {
        terminalDebug('completion-miss', {
          providers: providers.map(provider => provider.id),
          chars: text.length,
          elapsedMs: Math.round(performance.now() - started),
        });
        setOwnsCompletion(false); return;
      }
      const candidates = result.candidates;
      if (request !== sequence.current || latest.current.text !== text || latest.current.cwd !== context.cwd
        || latest.current.connectionId !== context.connectionId || latest.current.shell !== context.shell
        || !latest.current.visible || !latest.current.isFocused || inputRef.current !== input
        || document.activeElement !== input || input.selectionStart !== cursor || input.selectionEnd !== cursor || !candidates.length) return;
      terminalDebug('completion-resolved', { provider: result.provider, chars: text.length, elapsedMs: Math.round(performance.now() - started) });
      const index = reverse ? candidates.length - 1 : 0;
      cycle.current = { base: text, cursor, candidates, index, current: text };
      apply(candidates[index]!);
    });
    return true;
  };
  const restorePathCompletion = () => {
    const current = cycle.current;
    if (pending.current) { sequence.current++; pending.current = false; setOwnsCompletion(false); return true; }
    if (!current || current.current !== text) return false;
    sequence.current++; cycle.current = null; setOwnsCompletion(false);
    apply({ text: current.base, cursor: current.cursor }); return true;
  };
  return { acceptPathCompletion, restorePathCompletion, ownsCompletion, isCyclingPathCompletion: () => pending.current || cycle.current !== null };
}
