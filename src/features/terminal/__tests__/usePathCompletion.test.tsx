import { act, renderHook, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSessionStore } from '@features/workspace';
import { useHistoryStore } from '../stores/history';
import { usePathCompletion } from '../hooks/usePathCompletion';
import { completeShell, warmShellCompletion } from '@platform/api/completion';
vi.mock('@platform/api/completion', () => ({ completeShell: vi.fn(), warmShellCompletion: vi.fn() }));
vi.mock('@platform/runtime', async importOriginal => ({ ...(await importOriginal<typeof import('@platform/runtime')>()), isWindows: true }));

const mocks = vi.hoisted(() => ({ list: vi.fn(), fileOpsFor: vi.fn() }));
vi.mock('@features/files', () => ({ fileOpsFor: mocks.fileOpsFor }));
const snapshot = useSessionStore.getState();
const historySnapshot = useHistoryStore.getState();
let input: HTMLTextAreaElement;
let paneId: string;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(completeShell).mockResolvedValue([]);
  vi.mocked(warmShellCompletion).mockResolvedValue(undefined);
  useHistoryStore.setState({ entries: [] });
  const tabId = useSessionStore.getState().addTab({ cwd: '/work', shellType: 'bash' });
  paneId = `${tabId}#0`;
  input = document.createElement('textarea'); document.body.append(input); input.focus();
  mocks.list.mockResolvedValue({ entries: [
    { name: 'readme', path: '/work/readme', is_dir: false },
    { name: 'release', path: '/work/release', is_dir: false },
  ] });
  mocks.fileOpsFor.mockReturnValue({ list: mocks.list, join: (directory: string, name: string) => `${directory}/${name}` });
});
afterEach(() => {
  input.remove();
  useSessionStore.setState(snapshot, true);
  useHistoryStore.setState(historySnapshot, true);
});

function mount(initial = 'cat re') {
  return renderHook(({ cwd }) => {
    const [text, setText] = useState(initial);
    useEffect(() => { input.value = text; input.setSelectionRange(text.length, text.length); }, [text]);
    return { text, setText, ...usePathCompletion({ paneId, text, setText, cwd, visible: true, isFocused: true, inputRef: { current: input } }) };
  }, { initialProps: { cwd: '/work' } });
}

it('accepts, cycles backward and restores the original typed path', async () => {
  const { result } = mount();
  act(() => { expect(result.current.acceptPathCompletion(false)).toBe(true); });
  await waitFor(() => expect(result.current.text).toBe('cat readme'));
  act(() => { result.current.acceptPathCompletion(true); });
  expect(result.current.text).toBe('cat release');
  act(() => { result.current.restorePathCompletion(); });
  expect(result.current.text).toBe('cat re');
  expect(mocks.fileOpsFor).toHaveBeenCalledWith({ kind: 'local' });
  expect(completeShell).not.toHaveBeenCalled();
});

it('lets shell candidates own the cycle before reading paths', async () => {
  vi.mocked(completeShell).mockResolvedValue([{ text: 'git status', cursor: 10 }, { text: 'git stash', cursor: 9 }]);
  const { result } = mount('git');
  act(() => { result.current.acceptPathCompletion(false); });
  await waitFor(() => expect(result.current.text).toBe('git status'));
  expect(mocks.list).not.toHaveBeenCalled();
  act(() => { result.current.acceptPathCompletion(true); });
  expect(result.current.text).toBe('git stash');
  act(() => { result.current.restorePathCompletion(); });
  expect(result.current.text).toBe('git');
});

it('prefers command history without starting the shell or reading paths', async () => {
  useHistoryStore.setState({ entries: [
    { command: 'cat readme', cwd: '/work', timestamp: 2, exitCode: 0 },
    { command: 'cat release', cwd: '/work', timestamp: 1, exitCode: 0 },
  ] });
  const { result } = mount();
  act(() => { result.current.acceptPathCompletion(false); });
  await waitFor(() => expect(result.current.text).toBe('cat readme'));
  act(() => { result.current.acceptPathCompletion(true); });
  expect(result.current.text).toBe('cat release');
  expect(completeShell).not.toHaveBeenCalled();
  expect(mocks.list).not.toHaveBeenCalled();
});

it('never inserts a multiline history suffix into the command draft', async () => {
  useHistoryStore.setState({ entries: [
    { command: 'cat readme\nrm -rf /', cwd: '/work', timestamp: 1, exitCode: 0 },
  ] });
  const { result } = mount();
  act(() => { result.current.acceptPathCompletion(false); });
  await waitFor(() => expect(result.current.text).toBe('cat readme'));
  expect(result.current.text).not.toContain('\n');
});

it('cancels a pending shell request with Escape without starting path completion', async () => {
  let finish: (value: { text: string; cursor: number }[]) => void = () => {};
  vi.mocked(completeShell).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { result } = mount('git');
  act(() => { result.current.acceptPathCompletion(false); });
  act(() => { expect(result.current.restorePathCompletion()).toBe(true); });
  await act(async () => { finish([]); });
  expect(result.current.text).toBe('git'); expect(mocks.list).not.toHaveBeenCalled();
});

it('ignores late reads after editing or switching the terminal directory', async () => {
  let finish: (value: { entries: { name: string; is_dir: boolean }[] }) => void = () => {};
  mocks.list.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { result, rerender } = mount();
  act(() => { result.current.acceptPathCompletion(false); });
  act(() => { result.current.setText('cat other'); });
  await act(async () => { finish({ entries: [{ name: 'readme', is_dir: false }] }); });
  expect(result.current.text).toBe('cat other');
  act(() => { result.current.setText('cat re'); });
  act(() => { result.current.acceptPathCompletion(false); });
  rerender({ cwd: '/other' });
  await act(async () => { finish({ entries: [{ name: 'readme', is_dir: false }] }); });
  expect(result.current.text).toBe('cat re');
});

it('uses only the matching remote file channel for a remote pane', async () => {
  const tabId = useSessionStore.getState().addTab({ kind: 'ssh', ssh: { host: 'test.local', user: 'test', name: 'Remote', connectionId: 'remote-1' } });
  paneId = `${tabId}#0`;
  const { result } = mount();
  act(() => { result.current.acceptPathCompletion(false); });
  await waitFor(() => expect(result.current.text).toBe('cat readme'));
  expect(mocks.fileOpsFor).toHaveBeenCalledWith({ kind: 'ssh', connectionId: 'remote-1' });
  expect(completeShell).not.toHaveBeenCalled();
});

it('warms the resident helper for a local PowerShell pane', async () => {
  const tabId = useSessionStore.getState().addTab({ cwd: '/work', shellType: 'powershell' });
  paneId = `${tabId}#0`;
  mount();
  await waitFor(() => expect(warmShellCompletion).toHaveBeenCalledWith('powershell'));
});
