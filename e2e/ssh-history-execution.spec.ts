import { expect, test } from '@playwright/test';
import { emitPtyOutput, setupTauriMock } from './tauri-mock';

test('history execution retains the SSH session through command and toolbar state changes', async ({ page }) => {
  await setupTauriMock(page, { sshHost: 'known', terminalDirectories: true });
  await page.addInitScript(() => {
    localStorage.setItem('vrykell-agent-settings', JSON.stringify({ version: 8, state: { global: { sshOpenMode: 'block' }, overrides: {} } }));
    localStorage.setItem('vrykell-command-history-settings', JSON.stringify({ version: 0, state: { runIn: 'new', doubleClick: 'insert', migrated: true } }));
    localStorage.setItem('mock-command-history-runs', JSON.stringify([
      { id: 'remote-build', target: JSON.stringify(['ssh', 'prod.example.com', 22, 'root']), shell: 'posix',
        command: 'make release', cwd: '/srv/app', status: 'success', exitCode: 0, timestamp: 3000, runCount: 1 },
    ]));
  });
  await page.goto('/');
  const paneId = await page.evaluate(async () => {
    const workspacePath = '/src/features/workspace/stores/workspace.ts';
    const startupPath = '/src/features/terminal/services/terminalStartup.ts';
    const { useWorkspaceStore } = await import(workspacePath) as typeof import('../src/features/workspace/stores/workspace');
    const { waitForTerminalStartup } = await import(startupPath) as typeof import('../src/features/terminal/services/terminalStartup');
    const id = useWorkspaceStore.getState().addTab({ kind: 'ssh', cwd: '/srv/app',
      ssh: { name: 'Remote', host: 'prod.example.com', user: 'root', port: 22, connectionId: 'ssh-1' } });
    await waitForTerminalStartup(`${id}#0`);
    return `${id}#0`;
  });
  await page.getByRole('button', { name: '历史命令', exact: true }).click();
  const row = page.getByTestId('command-history-remote-build');
  await expect(row).toBeVisible();
  const sessionSnapshot = () => page.evaluate(async paneId => {
    const path = '/src/features/terminal/stores/terminal.ts';
    const { useTerminalStore } = await import(path) as typeof import('../src/features/terminal/stores/terminal');
    const scope = window as unknown as { __PTY_SPAWNS__: unknown[]; __PTY_CLOSES__: unknown[] };
    return { id: useTerminalStore.getState().sessions[paneId], spawns: scope.__PTY_SPAWNS__.length,
      closes: scope.__PTY_CLOSES__.length };
  }, paneId);
  const initial = await sessionSnapshot();
  await page.getByRole('button', { name: '历史命令操作', exact: true }).click();
  await page.getByRole('button', { name: '历史命令设置', exact: true }).click();
  await page.getByRole('combobox', { name: '命令执行目标' }).click();
  await page.getByRole('option', { name: '当前终端', exact: true }).click();
  await page.getByRole('navigation', { name: '工作区', exact: true }).getByRole('button', { name: '终端会话', exact: true }).click();
  await page.getByRole('tab', { name: 'Remote', exact: true }).click();
  await row.click();
  const run = page.getByRole('region', { name: '命令详情', exact: true }).getByRole('button', { name: '运行命令' });
  await expect(run).toHaveAttribute('data-tip', '在当前终端运行');
  await run.click();
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __PTY_WRITES__: string[] }).__PTY_WRITES__.includes('make release\n'))).toBe(true);
  await expect.poll(sessionSnapshot).toEqual(initial);
  await emitPtyOutput(page, '\x1b]133;E;dGFpbCAtZiAvc3J2L2FwcC9sb2c=\x07\x1b]133;C\x07streaming\r\n');
  await expect(page.getByTestId(`pane-${paneId}`).getByText('tail -f /srv/app/log 运行中', { exact: true })).toBeVisible({ timeout: 8000 });
  await expect.poll(sessionSnapshot).toEqual(initial);
  await emitPtyOutput(page, '\x1b]133;D;0\x07\x1b]133;A\x07$ \x1b]133;B\x07');
  await expect.poll(sessionSnapshot).toEqual(initial);
});
