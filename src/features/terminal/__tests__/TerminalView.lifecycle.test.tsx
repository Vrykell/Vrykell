import { useEffect } from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '@features/workspace/stores/workspace';
import { useTerminalStore } from '@features/terminal/stores/terminal';
import { useUiStore } from '@features/workspace/stores/ui';
import { useWorkspaceNavigation } from '@features/workspace/stores/navigation';
import { useUnifiedWorkspace } from '@features/workspace/stores/unifiedWorkspace';
import { leaf, removeLeaf, splitLeaf } from '@features/workspace/model/windowLayout';
import { ResourceContentProvider, ResourceContentSlot } from '@ui/layout/ResourceContent';
import TerminalView from '../components/TerminalView';

const { mounts, disposals } = vi.hoisted(() => ({ mounts: vi.fn(), disposals: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@features/workspace/services/sessionManager', () => ({ saveLayout: vi.fn() }));
vi.mock('../components/TerminalPanel', () => ({ default: ({ paneId }: { paneId: string }) => {
  useEffect(() => { mounts(paneId); return () => disposals(paneId); }, [paneId]);
  return <div data-testid={`session-${paneId}`} />;
} }));
vi.mock('../components/InputEditor', () => ({ default: () => null }));
vi.mock('../components/TerminalBlockList', () => ({ default: () => <div data-testid="live-block-output" />, hasVisibleContent: () => false }));
vi.mock('@features/chat/components/PaneChatHistory', () => ({ default: () => null }));
vi.mock('@features/chat/components/AiWorkspaceSurface', () => ({ default: () => null }));
vi.mock('@features/workspace/components/TerminalLauncher', () => ({ default: () => null }));
vi.mock('@features/ssh/components/SshStatusPanel', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));

beforeEach(() => {
  mounts.mockClear(); disposals.mockClear();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  useUiStore.setState({ settingsOpen: false, splitPlacement: { open: false, spec: null }, movePlacement: { open: false, terminalId: null }, splitPickerOpen: false });
  useWorkspaceNavigation.setState({ area: 'terminal' });
  useUnifiedWorkspace.setState({ activeTabId: '', layout: null, focused: '', zoomed: null, startActive: true });
  useWorkspaceStore.setState({ tabs: [{ id: 'window', title: 'Terminal', kind: 'session', layout: leaf({ id: 'pane-a', kind: 'local', openMode: 'block' }) }], activeId: 'window' });
  useTerminalStore.setState({ sessions: { 'pane-a': 'session-a' }, scenes: { 'pane-a': 'altScreen' }, focusedPaneId: 'pane-a', manualFullscreen: {} });
});

it('keeps live terminal hosts mounted through split, move, resize and close', () => {
  render(<TerminalView />);
  const original = screen.getByTestId('session-pane-a');
  const originalTerminal = { id: 'pane-a', kind: 'local' as const, openMode: 'block' as const };
  const single = leaf(originalTerminal);
  const split = splitLeaf(single, 'pane-a', 'row', 'second', { id: 'pane-b', kind: 'local', openMode: 'block' });
  act(() => useWorkspaceStore.getState().setWindowLayout('window', split));
  expect(screen.getByTestId('session-pane-a')).toBe(original);
  expect(disposals).not.toHaveBeenCalled();
  const remaining = removeLeaf(split, 'pane-a')!;
  const moved = splitLeaf(remaining, 'pane-b', 'col', 'second', originalTerminal);
  act(() => useWorkspaceStore.getState().setWindowLayout('window', moved));
  expect(screen.getByTestId('session-pane-a')).toBe(original);
  expect(disposals).not.toHaveBeenCalled();
  act(() => useWorkspaceStore.getState().setWindowLayout('window', removeLeaf(moved, 'pane-b')!));
  expect(screen.getByTestId('session-pane-a')).toBe(original);
  expect(mounts.mock.calls.filter(([paneId]) => paneId === 'pane-a')).toHaveLength(1);
  expect(disposals.mock.calls).toEqual([['pane-b']]);
});

it('reveals a manually fullscreened live block when a split moves focus to another pane', () => {
  useTerminalStore.setState({ manualFullscreen: { 'pane-a': true } });
  render(<TerminalView />);
  const original = screen.getByTestId('session-pane-a');
  expect(screen.getByTestId('tui-fullscreen')).toBeVisible();
  act(() => {
    const split = splitLeaf(leaf({ id: 'pane-a', kind: 'local' }), 'pane-a', 'row', 'second', { id: 'pane-b', kind: 'local' });
    useWorkspaceStore.getState().setWindowLayout('window', split);
    useTerminalStore.setState({ sessions: { 'pane-a': 'session-a', 'pane-b': 'session-b' }, focusedPaneId: 'pane-b' });
  });
  expect(screen.queryByTestId('tui-fullscreen')).not.toBeInTheDocument();
  expect(screen.getByTestId('pane-pane-a').querySelector('[data-testid="live-block-output"]')).toBeVisible();
  expect(screen.getByTestId('session-pane-a')).toBe(original);
  expect(disposals).not.toHaveBeenCalled();
});

it('suspends fullscreen for layout placement and restores it after cancellation without remounting', () => {
  useTerminalStore.setState({ manualFullscreen: { 'pane-a': true } });
  render(<TerminalView />);
  const original = screen.getByTestId('session-pane-a');
  act(() => useUiStore.getState().beginSplit(null));
  expect(screen.queryByTestId('tui-fullscreen')).not.toBeInTheDocument();
  expect(screen.getByTestId('pane-pane-a').querySelector('[data-testid="live-block-output"]')).toBeVisible();
  act(() => useUiStore.getState().cancelSplit());
  expect(screen.getByTestId('tui-fullscreen')).toBeVisible();
  expect(screen.getByTestId('session-pane-a')).toBe(original);
  expect(disposals).not.toHaveBeenCalled();
});

it('hosts a manually fullscreened block inside its pane when the unified workspace displays it', () => {
  useWorkspaceNavigation.setState({ area: 'unified' });
  useUnifiedWorkspace.setState({ layout: { type: 'pane', id: 'cell-a', resourceId: 'terminal:pane-a' }, startActive: false });
  useTerminalStore.setState({ manualFullscreen: { 'pane-a': true } });
  render(<ResourceContentProvider>
    <section data-testid="placed"><ResourceContentSlot id="terminal:pane-a" visible focused /></section>
    <TerminalView active={false} />
  </ResourceContentProvider>);
  const fullscreen = screen.getByTestId('tui-fullscreen');
  expect(screen.getByTestId('placed')).toContainElement(fullscreen);
  expect(screen.getByTestId('pane-pane-a')).toContainElement(fullscreen);
  expect(screen.getByTestId('session-pane-a')).toBeInTheDocument();
});
