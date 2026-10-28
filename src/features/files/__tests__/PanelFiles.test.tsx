import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import PanelFiles from '../components/PanelFiles';
import { useSessionStore } from '@features/workspace';
import { ptyWrite } from '@platform/pty';
import { useLocalPathStore } from '@features/files/services/localPath';
import { useEditorPreferences } from '@config/editor';

vi.mock('@features/workspace/hooks/useActiveWorkspace', () => ({ useActiveWorkspace: () => ({ focusedSpec: null, focusedPaneId: '', activeCwd: '/tmp', sessions: {} }) }));
vi.mock('@features/files/components/FilePanel', () => ({
  default: ({ initialPath, initialResolved, onPathChange, openEntry }: {
    initialPath: string | null;
    initialResolved: boolean;
    onPathChange?: (path: string | null) => void;
    openEntry: (entry: { path: string; name: string; is_dir: boolean }) => void;
  }) => (
    <>
      <span data-testid="panel-start">{JSON.stringify({ initialPath, initialResolved })}</span>
      <button onClick={() => onPathChange?.('/remembered')}>Navigate</button>
      <button onClick={() => openEntry({ path: '/tmp/config.ini', name: 'config.ini', is_dir: false })}>Open file</button>
    </>
  ),
}));
vi.mock('@features/files/services/fileOpen', () => ({ openFile: async (_path: string, execute: (command: string) => void) => { execute('vim /tmp/config.ini'); return { via: 'terminal', editor: 'vim' }; } }));
vi.mock('@features/terminal/services/terminalStartup', () => ({ waitForTerminalStartup: async () => 'file-session' }));
vi.mock('@platform/shells', () => ({ getAvailableShells: async () => [{ id: 'zsh', default: false }, { id: 'bash', default: true }] }));
vi.mock('@platform/pty', () => ({ ptyWrite: vi.fn(async () => {}) }));
vi.mock('@features/ssh', () => ({ ensureSshLoaded: vi.fn(), useSshStore: (select: (state: { connections: never[]; loaded: boolean }) => unknown) => select({ connections: [], loaded: true }) }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); useLocalPathStore.setState({ remembered: null }); });

it('opens files in the real default shell and retains that shell on the new tab', async () => {
  useEditorPreferences.setState({ localOpenMode: 'terminal' });
  const addTab = vi.spyOn(useSessionStore.getState(), 'addTab').mockReturnValue('file-tab');
  render(<PanelFiles />);
  fireEvent.click(screen.getByRole('button', { name: 'Open file' }));
  await waitFor(() => expect(ptyWrite).toHaveBeenCalledWith('file-session', 'vim /tmp/config.ini\n'));
  expect(addTab).toHaveBeenCalledWith({ cwd: '/tmp', title: 'config.ini', shellType: 'bash' });
});

it('opens a file in the built-in editor by default without sending terminal input', () => {
  useEditorPreferences.setState({ localOpenMode: 'editor' });
  const open = vi.spyOn(useSessionStore.getState(), 'openEditorFile').mockReturnValue('editor');
  render(<PanelFiles />); fireEvent.click(screen.getByRole('button', { name: 'Open file' }));
  expect(open).toHaveBeenCalledWith({ path: '/tmp/config.ini' });
});

it('local panel: starts at the terminal cwd without a remembered path, remembers the directory after navigating and restores it on remount', () => {
  render(<PanelFiles />);
  expect(screen.getByTestId('panel-start')).toHaveTextContent(JSON.stringify({ initialPath: '/tmp', initialResolved: false }));

  fireEvent.click(screen.getByRole('button', { name: 'Navigate' }));
  expect(useLocalPathStore.getState().remembered).toEqual({ path: '/remembered' });

  cleanup();
  render(<PanelFiles />);
  expect(screen.getByTestId('panel-start')).toHaveTextContent(JSON.stringify({ initialPath: '/remembered', initialResolved: true }));
});

it('local panel: treats a remembered drive view (null) as a resolved directory', () => {
  useLocalPathStore.setState({ remembered: { path: null } });
  render(<PanelFiles />);
  expect(screen.getByTestId('panel-start')).toHaveTextContent(JSON.stringify({ initialPath: null, initialResolved: true }));
});
