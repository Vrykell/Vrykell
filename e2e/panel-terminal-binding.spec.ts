import { expect, test, type Page } from '@playwright/test';
import { setupTauriMock, waitForWorkbench } from './tauri-mock';

// This scenario lifts the shared 30 s default: it opens three panels and switches focus
// between two terminals, which is slower than a single-surface regression.
test.setTimeout(120_000);

async function setupTerminals(page: Page) {
  return page.evaluate(async () => {
    const workspacePath = '/src/features/workspace/stores/workspace.ts';
    const terminalPath = '/src/features/terminal/stores/terminal.ts';
    const { useWorkspaceStore, terminalsOf } = await import(workspacePath) as typeof import('../src/features/workspace/stores/workspace');
    const { useTerminalStore } = await import(terminalPath) as typeof import('../src/features/terminal/stores/terminal');
    const state = useWorkspaceStore.getState();
    const tabs = state.tabs.filter(tab => tab.kind === 'session');
    const original = tabs[0]!;
    const originalPane = terminalsOf(original)[0]!;
    const boundTab = 'bound-tab';
    const boundPane = 'bound-tab#0';
    useTerminalStore.setState(current => ({
      focusedPaneId: originalPane.id,
      sessions: { ...current.sessions, [boundPane]: 'bound-session' },
      startupStates: { ...current.startupStates, [boundPane]: 'ready' },
    }));
    useWorkspaceStore.setState(current => ({
      activeId: original.id,
      tabs: [...current.tabs, {
        id: boundTab, title: 'Bound shell', kind: 'session' as const,
        layout: { type: 'leaf' as const, terminal: { id: boundPane, kind: 'local' as const, cwd: '/home/e2e' } },
      }],
      terminalCwds: {
        ...current.terminalCwds,
        [originalPane.id]: '/home/e2e/project',
        [boundPane]: '/home/e2e',
      },
    }));
    return { originalTab: original.id, originalPane: originalPane.id, boundTab, boundPane };
  });
}

async function setFocus(page: Page, tabId: string, paneId: string, cwd?: string) {
  await page.evaluate(async ({ tabId, paneId, cwd }) => {
    const workspacePath = '/src/features/workspace/stores/workspace.ts';
    const terminalPath = '/src/features/terminal/stores/terminal.ts';
    const { useWorkspaceStore } = await import(workspacePath) as typeof import('../src/features/workspace/stores/workspace');
    const { useTerminalStore } = await import(terminalPath) as typeof import('../src/features/terminal/stores/terminal');
    useWorkspaceStore.setState(state => ({
      activeId: tabId,
      ...(cwd ? { terminalCwds: { ...state.terminalCwds, [paneId]: cwd } } : {}),
    }));
    useTerminalStore.getState().setFocusedPane(paneId);
  }, { tabId, paneId, cwd });
}

async function bindPanel(page: Page, trigger: string, terminalLabel: string) {
  await page.getByTestId(trigger).click();
  const bind = page.getByRole('menuitem', { name: '绑定终端' });
  await bind.hover();
  const submenu = page.getByRole('menu', { name: '绑定终端' });
  await expect(submenu.getByRole('menuitemradio', { name: '跟随聚焦终端' })).toBeVisible();
  await submenu.getByRole('menuitemradio', { name: terminalLabel }).click();
}

test('binds files, command history and source control panels to a terminal', async ({ page }) => {
  await setupTauriMock(page, { launchDirectory: '/home/e2e/project', terminalDirectories: true });
  await page.goto('/');
  await waitForWorkbench(page);
  await page.waitForFunction(async () => {
    const path = '/src/features/terminal/stores/terminal.ts';
    const { useTerminalStore } = await import(path) as typeof import('../src/features/terminal/stores/terminal');
    return Object.values(useTerminalStore.getState().startupStates).includes('ready');
  });
  const terminals = await setupTerminals(page);
  // The inactive tab still receives its initial prompt; restore the bound cwd after that
  // report so the test can distinguish the two terminals.
  await page.waitForFunction(async () => {
    const path = '/src/features/terminal/stores/terminal.ts';
    const { useTerminalStore } = await import(path) as typeof import('../src/features/terminal/stores/terminal');
    return Boolean(useTerminalStore.getState().sessions['bound-tab#0']);
  });
  await page.evaluate(async () => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    // Fall back to the tab's configured directory so the two terminals stay distinct.
    useWorkspaceStore.setState(state => {
      const terminalCwds = { ...state.terminalCwds };
      delete terminalCwds['bound-tab#0'];
      return { terminalCwds };
    });
  });
  await page.evaluate(() => {
    localStorage.setItem('mock-git-snapshots', JSON.stringify({
      '/home/e2e': { root: '/home/e2e', branch: 'bound-branch', remotes: [], entries: [] },
      '/home/e2e/project': { root: '/home/e2e/project', branch: 'focused-branch', remotes: [], entries: [] },
      '/home/e2e/Documents': { root: '/home/e2e/Documents', branch: 'docs-branch', remotes: [], entries: [] },
    }));
  });

  // Files: bind to the live terminal in the other tab and leave the focused cwd.
  await page.locator('[data-dock-btn="files"]').click();
  const tree = page.getByTestId('local-file-tree');
  await expect(tree).toHaveAttribute('data-path', '/home/e2e/project');
  await bindPanel(page, 'local-more-btn', 'Bound shell');
  await expect(tree).toHaveAttribute('data-path', '/home/e2e');
  expect(await page.evaluate(async () => {
    const bindingPath = '/src/features/workspace/stores/panelTerminal.ts';
    const { usePanelTerminalStore } = await import(bindingPath) as typeof import('../src/features/workspace/stores/panelTerminal');
    return usePanelTerminalStore.getState().bindings.files?.paneId;
  })).toBe('bound-tab#0');

  // The binding survives a focus tab change and a new focused cwd.
  await setFocus(page, terminals.originalTab, terminals.originalPane, '/home/e2e/Documents');
  await expect(tree).toHaveAttribute('data-path', '/home/e2e');

  // The directory sync action now targets the bound pane, not the focused terminal.
  await page.evaluate(() => {
    const host = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> }; __BOUND_WRITES__?: unknown[] };
    const original = host.__TAURI_INTERNALS__.invoke;
    host.__BOUND_WRITES__ = [];
    host.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === 'pty_write') host.__BOUND_WRITES__!.push({ id: args.id, data: args.data });
      return original(command, args);
    };
  });
  await page.getByTestId('local-more-btn').click();
  await page.getByRole('button', { name: /终端切换到当前目录/ }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __BOUND_WRITES__?: { id: string; data: string }[] }).__BOUND_WRITES__ ?? []))
    .toEqual(expect.arrayContaining([expect.objectContaining({ data: expect.stringContaining('/home/e2e') })]));

  // Command history: the bound project remains while another terminal is focused.
  await page.getByRole('button', { name: '历史命令', exact: true }).click();
  await expect(page.getByTestId('command-history-more')).toBeVisible();
  await bindPanel(page, 'command-history-more', 'Bound shell');
  await expect(page.locator('.command-history-root')).toContainText('/home/e2e');
  await setFocus(page, terminals.originalTab, terminals.originalPane, '/home/e2e/Documents');
  await expect(page.locator('.command-history-root')).toContainText('/home/e2e');

  // Source control: the bound repository wins over the focused terminal and editor navigation.
  await page.getByRole('button', { name: '版本控制', exact: true }).click();
  const git = page.getByTestId('git-panel');
  await expect(git.getByText('docs-branch', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '更多版本控制操作' }).click();
  const gitBind = page.getByRole('menuitem', { name: '绑定终端' });
  await gitBind.hover();
  const gitSubmenu = page.getByRole('menu', { name: '绑定终端' });
  await gitSubmenu.getByRole('menuitemradio', { name: 'Bound shell' }).click();
  await expect(git).toHaveAttribute('data-bound-pane', 'bound-tab#0');
  // The bound target survives a focus switch even when the terminal mock shares a session id.
  await setFocus(page, terminals.originalTab, terminals.originalPane, '/home/e2e/project');
  await expect(git).toHaveAttribute('data-bound-pane', 'bound-tab#0');
  await page.getByRole('button', { name: '更多版本控制操作' }).click();
  await page.getByRole('menuitem', { name: '绑定终端' }).hover();
  await expect(page.getByRole('menu', { name: '绑定终端' }).getByRole('menuitemradio', { name: 'Bound shell' }))
    .toHaveAttribute('aria-checked', 'true');
});
