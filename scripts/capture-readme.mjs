import { chromium, expect } from '@playwright/test';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setupTauriMock, emitAcpSession, acpUpdate, waitForWorkbench } from '../e2e/tauri-mock.ts';

const origin = process.env.README_ORIGIN ?? 'http://127.0.0.1:1432';
const directory = new URL('../docs/images/', import.meta.url);
const extraOnly = process.env.README_CAPTURE_EXTRA_ONLY === '1';
const selectedShots = process.env.README_CAPTURE_ONLY?.split(',').map(name => name.trim()).filter(Boolean);
const captures = [];
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });

async function capture(page, target) {
  captures.push({ path: fileURLToPath(target), bytes: await page.screenshot({ animations: 'disabled', omitBackground: true }) });
}

async function saveCapture({ path, bytes }) {
  const temporary = `${path}.new-${randomUUID()}`;
  try {
    await writeFile(temporary, bytes);
    for (let attempt = 0; ; attempt++) {
      try { await rename(temporary, path); break; }
      catch (error) {
        if (attempt >= 3 || !['EPERM', 'EACCES', 'EBUSY', 'UNKNOWN'].includes(error.code)) throw error;
        await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
      }
    }
  } finally { await rm(temporary, { force: true }); }
}
const code = `type ReleaseTarget = 'windows' | 'macos' | 'linux';

interface BuildPlan {
  version: string;
  branch: string;
  targets: ReleaseTarget[];
}

export const release: BuildPlan = {
  version: '0.1.0',
  branch: 'main',
  targets: ['windows', 'macos', 'linux'],
};

export function readyToShip(checks: boolean[]) {
  return checks.every(Boolean);
}
`;

async function chooseScheme(page, locale, mode, id) {
  await page.evaluate(async ({ mode, id }) => {
    const { useTerminalThemeStore } = await import('/src/features/settings/model/terminalTheme.ts');
    await useTerminalThemeStore.getState().update({ [`${mode}Preset`]: id });
  }, { mode, id });
  await page.keyboard.press('Control+,');
  await page.locator('.settings-navigation').getByRole('button', { name: locale === 'zh' ? '主题' : 'Theme', exact: true }).click();
  const label = mode === 'light' ? (locale === 'zh' ? '始终浅色' : 'Always light') : (locale === 'zh' ? '始终深色' : 'Always dark');
  await page.getByRole('radio', { name: label, exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveAttribute('data-theme-preset', id);
}

async function showWallpaper(page, file) {
  const body = await readFile(file);
  const path = '/readme-wallpaper-settings.jpg';
  await page.unroute('**/readme-wallpaper-*.jpg');
  await page.route('**/readme-wallpaper-*.jpg', route => route.fulfill({
    status: 200, contentType: file.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg',
    headers: { 'cache-control': 'no-store' }, body,
  }));
  const loaded = page.waitForResponse(response => response.url().endsWith(path) && response.ok());
  await page.evaluate(async path => {
    const { useTerminalThemeStore } = await import('/src/features/settings/model/terminalTheme.ts');
    await useTerminalThemeStore.getState().update({ backgroundImage: path, opacity: 0.9 });
  }, path);
  await loaded;
  await expect(page.locator('.application-window')).toHaveAttribute('data-wallpaper', 'true');
}

async function clearWallpaper(page) {
  await page.evaluate(async () => {
    const { useTerminalThemeStore } = await import('/src/features/settings/model/terminalTheme.ts');
    await useTerminalThemeStore.getState().update({ backgroundImage: null, opacity: 1 });
  });
  await page.unroute('**/readme-wallpaper-*.jpg');
}

async function captureSingleWorkspaces(page, locale) {
  const shot = async name => {
    if (selectedShots && !selectedShots.includes(name)) return;
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(1595, 895);
    await page.waitForTimeout(400);
    await capture(page, new URL(`${name}-${locale}.png`, directory));
    console.log(`${name}-${locale}.png`);
  };
  await page.getByTestId('workspace-area-terminal').click();
  await expect(page.locator('.terminal-pane:visible').first()).toContainText('npm run build');
  await page.evaluate(text => { window.__AI_REPLY__ = text; }, locale === 'zh' ? '构建和测试已完成，8 项检查通过。' : 'The build and tests finished successfully; all 8 checks passed.');
  await page.locator('[data-dock-btn="chat"]').click();
  const sidebarComposer = page.locator('[data-chat-composer]:visible');
  await sidebarComposer.fill(locale === 'zh' ? '这一轮构建通过了吗？' : 'Did this build pass?');
  await sidebarComposer.press('Enter');
  await expect(page.getByText(locale === 'zh' ? '构建和测试已完成，8 项检查通过。' : 'The build and tests finished successfully; all 8 checks passed.', { exact: true })).toBeVisible();
  await shot('single-terminal');
  await page.locator('[data-dock-btn="chat"]').click();

  await page.getByTestId('workspace-area-code').click();
  const releaseTab = page.getByTestId('workspace-instance-bar').locator('.folder-tab').filter({ hasText: 'release.ts' }).first();
  await expect(releaseTab).toBeVisible(); await releaseTab.click();
  await expect(page.locator('.monaco-editor:visible .view-lines')).toContainText('checks.every(Boolean)');
  await shot('single-editor');

  await page.getByTestId('workspace-area-ai').click();
  await page.getByTestId('ai-new-conversation').click();
  const reply = locale === 'zh' ? '可以按下面的顺序验证发布，并保留上一版本以便回滚。\n\n### 1. 检查构建与测试\n\n```bash\nnpm ci\nnpm run test\nnpm run build\n```\n\n### 2. 核对发布内容\n\n- 确认版本号与更新日志一致。\n- 检查各平台安装包和许可证。\n- 在预发布环境验证健康检查。\n\n如果部署后健康检查失败，先恢复上一版本，再查看服务日志。'
    : 'Use this sequence to verify the release, and keep the previous build ready for rollback.\n\n### 1. Check the build and tests\n\n```bash\nnpm ci\nnpm run test\nnpm run build\n```\n\n### 2. Review the release\n\n- Check the version and changelog agree.\n- Verify installers and bundled licenses.\n- Run health checks in staging.\n\nIf a health check fails after deployment, restore the previous build and inspect the service logs.';
  await page.evaluate(text => { window.__AI_REPLY__ = text; }, reply);
  const composer = page.locator('[data-chat-composer]:visible');
  await composer.fill(locale === 'zh' ? '准备发布前，请帮我整理构建验证和回滚步骤。' : 'Help me plan build verification and a rollback before release.');
  await composer.press('Enter'); await expect(page.getByText(locale === 'zh' ? '检查构建与测试' : 'Check the build and tests', { exact: false })).toBeVisible();
  await page.evaluate(() => { window.__FS_EXTRA_ENTRIES__ = [
    { name: 'src', path: '/work/atlas/src', is_dir: true },
    { name: 'tests', path: '/work/atlas/tests', is_dir: true },
    { name: 'release.ts', path: '/work/atlas/release.ts', is_dir: false },
    { name: 'deploy.yml', path: '/work/atlas/deploy.yml', is_dir: false },
    { name: 'CHANGELOG.md', path: '/work/atlas/CHANGELOG.md', is_dir: false },
    { name: 'package.json', path: '/work/atlas/package.json', is_dir: false },
  ]; });
  await page.locator('[data-dock-btn="files"]').click();
  await expect(page.locator('.workspace-side-panel[data-side="right"][data-visible="true"]')).toBeVisible();
  await shot('single-ai');
  await page.locator('[data-dock-btn="files"]').click();

  await page.getByTestId('workspace-area-ssh').click();
  await expect(page.getByTestId('ssh-dashboard')).toBeVisible();
  await page.waitForFunction(async () => (await import('/src/features/ssh/stores/store.ts')).useSshStore.getState().loaded);
  await page.evaluate(async locale => {
    const { useSshStore } = await import('/src/features/ssh/stores/store.ts');
    const { useHostLibrary } = await import('/src/features/ssh/stores/hostLibrary.ts');
    const first = useSshStore.getState().connections[0];
    useSshStore.setState({ connections: [{ ...first, name: locale === 'zh' ? '生产服务器' : 'production' },
      { ...first, id: 'demo-stage', name: 'staging', host: '192.0.2.20', user: 'deploy' },
      { ...first, id: 'demo-lab', name: 'lab', host: '192.0.2.30', user: 'ops' },
      { ...first, id: 'demo-worker', name: 'worker', host: '192.0.2.40', user: 'deploy' },
      { ...first, id: 'demo-database', name: 'database', host: '192.0.2.50', user: 'admin' },
      { ...first, id: 'demo-edge', name: 'edge', host: '192.0.2.60', user: 'ops' }] });
    for (const [id, group, tags, starred] of [[first.id, 'Production', ['api', 'primary'], true],
      ['demo-stage', 'Staging', ['testing'], false], ['demo-lab', 'Lab', ['tools'], false],
      ['demo-worker', 'Production', ['jobs'], false], ['demo-database', 'Production', ['database'], false],
      ['demo-edge', 'Production', ['gateway'], false]]) useHostLibrary.getState().update(id, { group, tags, starred });
    const samples = {
      [first.id]: [0.88, 0.74, 0.38, '0.12 0.08 0.05'], 'demo-stage': [0.94, 0.68, 0.24, '0.08 0.06 0.04'],
      'demo-lab': [0.76, 0.55, 0.51, '0.37 0.28 0.19'], 'demo-worker': [0.63, 0.41, 0.62, '0.82 0.71 0.64'],
      'demo-database': [0.82, 0.31, 0.57, '0.46 0.35 0.29'], 'demo-edge': [0.93, 0.79, 0.22, '0.09 0.07 0.05'],
    };
    const invoke = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (command, args, ...rest) => {
      const result = await invoke(command, args, ...rest);
      const sample = command === 'ssh_system_status' ? samples[args.id] : undefined;
      return sample ? { ...result, cpuIdle: Math.round(result.cpuTotal * sample[0]),
        memoryAvailable: Math.round(result.memoryTotal * sample[1]), diskUsed: Math.round(result.diskTotal * sample[2]), load: sample[3] } : result;
    };
  }, locale);
  const hosts = page.getByTestId('ssh-dashboard');
  await hosts.getByRole('button', { name: locale === 'zh' ? '卡片视图' : 'Card view', exact: true }).click();
  await expect(hosts.locator('.ssh-dashboard-card')).toHaveCount(6);
  await hosts.getByRole('switch', { name: locale === 'zh' ? '资源占用' : 'Resource usage', exact: true }).click();
  await expect(hosts.locator('.ssh-dashboard-card').first()).toContainText('26%');
  await page.locator('[data-dock-btn="chat"]').click();
  const hostSidebar = page.getByTestId('ai-sidebar-content');
  await expect(hostSidebar).toBeVisible();
  await hostSidebar.getByRole('button', { name: locale === 'zh' ? '新对话' : 'New conversation', exact: true }).click();
  await page.evaluate(text => { window.__AI_REPLY__ = text; }, locale === 'zh'
    ? '生产主机在线。发布前建议检查服务健康、磁盘空间和最近备份，确认回滚包可用。'
    : 'The production host is online. Before deploying, check service health, disk space and recent backups, and keep a rollback build ready.');
  const hostComposer = hostSidebar.locator('[data-chat-composer]');
  await hostComposer.fill(locale === 'zh' ? '部署前应该检查哪些项目？' : 'What should I check before deployment?');
  await hostComposer.press('Enter');
  await expect(hostSidebar).toContainText(locale === 'zh' ? '生产主机在线' : 'The production host is online');
  await expect(hosts.locator('.ssh-dashboard-card').first()).toContainText('12%', { timeout: 20000 });
  await shot('single-hosts');
  await page.locator('[data-dock-btn="chat"]').click();

  await page.keyboard.press('Control+,');
  await page.locator('.settings-navigation').getByRole('button', { name: locale === 'zh' ? '主题' : 'Theme', exact: true }).click();
  await expect(page.locator('.theme-preset-preview')).toHaveCount(6);
  if (process.env.README_WALLPAPER) {
    await showWallpaper(page, process.env.README_WALLPAPER);
    await shot('theme-settings');
    await clearWallpaper(page);
  } else {
    try { await access(fileURLToPath(new URL(`theme-settings-${locale}.png`, directory))); }
    catch { await shot('theme-settings'); }
  }
}

async function scene(locale, remote = false) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  await setupTauriMock(page, {
    terminalDirectories: true, launchDirectory: '/work/atlas', sshHost: 'known',
    aiModels: [{ id: 'm-local', name: locale === 'zh' ? '本地模型' : 'Local model', provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5',
      capabilities: { vision: false, reasoning: false, tools: true, search: false } }],
    aiActive: 'm-local',
  });
  await page.addInitScript(({ locale, code }) => {
    localStorage.setItem('vrykell-theme-mode', 'dark');
    localStorage.setItem('vrykell-language', JSON.stringify({ state: { preference: locale }, version: 0 }));
    localStorage.setItem('mock-editor-files', JSON.stringify({ '["","/work/atlas/release.ts"]': code }));
    localStorage.setItem('mock-acp-servers', JSON.stringify([{ name: 'Code Agent', command: 'demo-agent', args: [], env: {}, cwd: '/work/atlas', enabled: true }]));
  }, { locale, code });
  await page.goto(origin);
  await waitForWorkbench(page);
  await page.evaluate(() => { document.documentElement.style.clipPath = 'inset(0 round 16px)'; });
  await expect(page.locator('.terminal-pane:visible').first()).toBeVisible();
  await page.evaluate(() => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (command, args, ...rest) => {
      const result = await invoke(command, args, ...rest);
      return command === 'acp_open' ? { ...result, harness: 'Code Agent', agent: { ...result.agent,
        agentInfo: { name: 'sample-code-agent', title: 'Code Agent', version: '0.1.0' } } } : result;
    };
  });
  await page.evaluate(async ({ remote, locale }) => {
    const { useWorkspaceStore } = await import('/src/features/workspace/stores/workspace.ts');
    const { useWorkspaceNavigation } = await import('/src/features/workspace/stores/navigation.ts');
    const { useHarnessWorkspace } = await import('/src/features/chat/stores/harnessWorkspace.ts');
    const { useUnifiedWorkspace } = await import('/src/features/workspace/stores/unifiedWorkspace.ts');
    const { useBlockStore } = await import('/src/features/terminal/stores/blocks.ts');
    const { useWorkbenchStore } = await import('/src/features/workspace/stores/workbench.ts');
    const { useTypographyStore } = await import('/src/config/typography.ts');
    useTypographyStore.getState().update({ terminalFontSize: 15, editorFontSize: 15, chatFontSize: 15, commandHighlighting: true });
    const workspace = useWorkspaceStore.getState();
    let terminal = workspace.tabs.find(tab => tab.kind === 'session');
    if (remote) {
      const id = workspace.addTab({ kind: 'ssh', title: 'production · SSH', ssh: { connectionId: 'ssh-1', host: '203.0.113.10', user: 'deploy', name: 'production' } });
      terminal = useWorkspaceStore.getState().tabs.find(tab => tab.id === id);
    } else {
      workspace.renameTab(terminal.id, 'atlas · build');
    }
    const pane = terminal.layout.terminal;
    const commands = remote ? [
      ['systemctl status atlas-api --no-pager', '● atlas-api.service — API service\n   Loaded: loaded; enabled\n   Active: active (running)\n   Memory: 86.2M\n   Tasks: 12\n\nOct 28 09:40:12 api-01 Started API service.'],
      ['curl -s http://localhost:8080/health', '{\n  "status": "ok",\n  "version": "0.1.0",\n  "uptime": 1842\n}'],
      ['df -h /srv', 'Filesystem      Size  Used  Avail  Use%\n/dev/vda1        80G   26G    54G   33%'],
    ] : [
      ['git status --short', ' M src/release.ts\n M src/release.test.ts'],
      ['npm run test -- release', '✓ release.test.ts (8 tests)\n\nTest Files  1 passed (1)\n     Tests  8 passed (8)\n  Duration  428ms'],
      ['npm run build', 'tsc && vite build\n\nvite building for production...\n✓ 248 modules transformed.\ndist/index.html            0.64 kB\ndist/assets/app.js       184.32 kB\n\n✓ built in 1.42s'],
    ];
    const now = Date.now();
    const blocks = commands.map(([command, outputText], index) => ({
      id: `demo-block-${index}`, command, cwd: remote ? '/srv/atlas' : '/work/atlas', gitBranch: 'main', status: 'done', exitCode: 0,
      startedAt: now - (commands.length - index) * 5000, endedAt: now - (commands.length - index) * 5000 + 1420,
      wasLongRunning: false, outputHtml: outputText.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('\n', '<br>'),
      outputText, outputRaw: outputText.replaceAll('\n', '\r\n'), linesTruncated: 0,
    }));
    const connection = useHarnessWorkspace.getState().connect('Code Agent', remote ? '/srv/atlas' : '/work/atlas');
    if (!remote) workspace.openEditorFile({ path: '/work/atlas/release.ts' });
    const leaf = (id, resourceId) => ({ type: 'pane', id, resourceId });
    const term = leaf('showcase-terminal', `terminal:${pane.id}`);
    const agent = leaf('showcase-agent', `acp:${connection}`);
    const layout = remote ? { type: 'split', direction: 'row', ratio: 0.53, first: term, second: agent }
      : { type: 'split', direction: 'row', ratio: 0.36, first: leaf('showcase-editor', 'file:["","/work/atlas/release.ts"]'),
          second: { type: 'split', direction: 'row', ratio: 0.51, first: term, second: agent } };
    useWorkspaceNavigation.getState().selectArea('unified');
    useUnifiedWorkspace.getState().restore(layout, 'showcase-terminal');
    const active = useUnifiedWorkspace.getState().activeTabId;
    if (!remote) {
      workspace.openEditorFile({ path: '/work/atlas/deploy.yml' });
      workspace.openEditorFile({ path: '/work/atlas/CHANGELOG.md' });
      useWorkbenchStore.getState().update(state => ({ ...state,
        tabs: [...state.tabs.map(tab => tab.id === active ? { ...tab, title: locale === 'zh' ? '构建与审查' : 'Build & review', groupId: 'demo-project' } : tab),
          { id: 'demo-deployment', scope: 'unified', title: 'deploy.yml', groupId: 'demo-project', focused: 'demo-deploy-pane', layout: leaf('demo-deploy-pane', 'file:["","/work/atlas/deploy.yml"]') },
          { id: 'demo-notes', scope: 'unified', title: 'CHANGELOG.md', groupId: 'demo-docs', focused: 'demo-notes-pane', layout: leaf('demo-notes-pane', 'file:["","/work/atlas/CHANGELOG.md"]') }],
        groups: [...state.groups, { id: 'demo-project', scope: 'unified', title: 'Atlas', collapsed: false }, { id: 'demo-docs', scope: 'unified', title: locale === 'zh' ? '发布记录' : 'Release notes', collapsed: true }],
      }));
      useWorkspaceNavigation.getState().setGroupColor('demo-project', 'blue');
      useWorkspaceNavigation.getState().setGroupColor('demo-docs', 'green');
      useWorkspaceNavigation.getState().setCollapsed(true);
    }
    useWorkspaceNavigation.getState().selectArea('unified');
    useUnifiedWorkspace.getState().selectTab(active);
    window.__SHOWCASE__ = { connection, locale, terminalId: terminal.id, paneId: pane.id, blocks };
  }, { remote, locale });
  await expect(page.getByTestId('unified-workspace').getByTestId('harness-composer')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__ACP_CALLS__?.some(item => item.startsWith('acp_open:')))).toBeTruthy();
  await page.evaluate(async () => {
    const { useBlockStore } = await import('/src/features/terminal/stores/blocks.ts');
    const { useTerminalStore } = await import('/src/features/terminal/stores/terminal.ts');
    const { useWorkspaceStore } = await import('/src/features/workspace/stores/workspace.ts');
    const { paneId, blocks, terminalId } = window.__SHOWCASE__;
    useBlockStore.getState().setBlocks(paneId, blocks);
    useWorkspaceStore.setState(state => ({ terminalCwds: { ...state.terminalCwds, [paneId]: blocks[0].cwd } }));
    useTerminalStore.setState(state => ({ scenes: { ...state.scenes, [paneId]: 'blockList' } }));
    useWorkspaceStore.getState().activate(terminalId);
  });
  const message = remote ? (locale === 'zh' ? '检查服务状态，帮我制定一个可回滚的部署检查清单。' : 'Inspect the service and propose a deployment checklist with a rollback plan.')
    : (locale === 'zh' ? '检查发布配置和构建结果，告诉我合并前还需要验证什么。' : 'Review the release plan and build output. What should I verify before merging?');
  const answer = remote ? (locale === 'zh' ? '服务正在运行，健康检查返回 `ok`，磁盘使用率为 **33%**。\n\n### 部署前检查\n\n1. 记录当前版本和配置。\n2. 确认最近一次备份可以恢复。\n3. 在预发布环境验证变更。\n\n### 回滚准备\n\n保留上一版本的构建产物；健康检查失败时恢复原版本并重新验证。\n\n执行变更前请先确认目标主机和操作范围。' : 'The service is running, health checks return `ok`, and disk usage is **33%**.\n\n### Before deployment\n\n1. Record the current version and configuration.\n2. Verify the latest backup can be restored.\n3. Test the change in staging.\n\n### Rollback plan\n\nKeep the previous build available. Restore it if health checks fail, then verify the service again.\n\nConfirm the target host and scope before making changes.')
    : (locale === 'zh' ? '配置和构建结果一致：三个桌面目标都从 `main` 构建。\n\n### 已确认\n\n- 发布配置的类型检查通过。\n- 8 项发布用例通过。\n- 生产构建已完成。\n\n### 合并前再检查\n\n1. 确认三个清单的版本号一致。\n2. 核对安装包中的字体和许可。\n3. 在各目标平台启动安装包。\n\n可以先查看差异，再批准后续操作。' : 'The release plan and build output agree: all three desktop targets build from `main`.\n\n### Verified\n\n- Release configuration passes type checking.\n- All 8 release tests pass.\n- The production build completes.\n\n### Before merging\n\n1. Check version consistency across manifests.\n2. Verify bundled fonts and licenses.\n3. Launch each platform installer.\n\nReview the diff before approving further changes.');
  await emitAcpSession(page, acpUpdate('sess_e2e', { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: message } }));
  await emitAcpSession(page, acpUpdate('sess_e2e', { sessionUpdate: 'tool_call', toolCallId: 'review-demo', kind: 'read', title: remote ? 'Inspect service status' : 'Read release.ts', status: 'completed', rawInput: { path: remote ? '/srv/atlas' : '/work/atlas/release.ts' } }));
  await emitAcpSession(page, acpUpdate('sess_e2e', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: answer } }));
  await expect(page.getByTestId('unified-workspace')).toContainText(answer.split('\n')[0].replaceAll('`', '').replaceAll('**', ''));
  await page.getByTestId('unified-workspace').locator('.terminal-pane:visible').click({ position: { x: 100, y: 35 } });
  await page.evaluate(() => document.fonts.ready);
  if (!remote) {
    await expect(page.locator('.monaco-editor:visible .view-lines')).toContainText('checks.every(Boolean)', { timeout: 30000 });
  }
  await expect(page.getByTestId('unified-workspace')).toContainText(remote ? 'df -h /srv' : 'npm run build');
  await page.evaluate(async () => {
    const { useToastStore } = await import('/src/ui/feedback/Toast.tsx');
    for (const toast of useToastStore.getState().toasts) useToastStore.getState().removeToast(toast.id);
  });
  await page.mouse.move(1595, 895);
  await page.waitForTimeout(400);
  const path = new URL(`${remote ? 'scenario-remote' : 'hero-workspace'}-${locale}.png`, directory);
  if (!extraOnly) { await capture(page, path); console.log(path.href); }
  if (!remote && !extraOnly) {
    for (const variant of [
      { name: 'theme-light', mode: 'light', id: 'catppuccin-latte' },
      { name: 'theme-nord', mode: 'dark', id: 'nord-dark' },
    ]) {
      await chooseScheme(page, locale, variant.mode, variant.id);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      const variantPath = new URL(`${variant.name}-${locale}.png`, directory);
      await capture(page, variantPath);
      console.log(variantPath.href);
    }
    await chooseScheme(page, locale, 'dark', 'default-dark');
  }
  if (!remote) {
    await page.evaluate(async () => {
      const { useUnifiedWorkspace } = await import('/src/features/workspace/stores/unifiedWorkspace.ts');
      const { useWorkspaceNavigation } = await import('/src/features/workspace/stores/navigation.ts');
      const { useWorkbenchStore } = await import('/src/features/workspace/stores/workbench.ts');
      const active = useUnifiedWorkspace.getState().activeTabId;
      useWorkbenchStore.getState().update(state => ({ ...state, tabs: state.tabs.map(tab => tab.id === active ? { ...tab, title: 'release.ts + build',
        layout: { type: 'split', direction: 'row', ratio: 0.50, first: tab.layout.first, second: tab.layout.second.first } } : tab) }));
      useWorkspaceNavigation.getState().setCollapsed(false);
    });
    await expect(page.locator('.monaco-editor:visible .view-lines')).toContainText('checks.every(Boolean)');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    if (!extraOnly) await capture(page, new URL(`scenario-build-${locale}.png`, directory));
    await captureSingleWorkspaces(page, locale);
  }
  await context.close();
}

async function captureCoreWorkflows(locale) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  await setupTauriMock(page, { launchDirectory: '/work/atlas', terminalDirectories: true });
  const original = `interface HistoryEntry {
  command: string;
  directory: string;
  exitCode: number | null;
}

export function recentCommands(
  entries: HistoryEntry[],
  directory: string,
) {
  return entries
    .filter(entry => entry.exitCode === 0)
    .map(entry => entry.command);
}
`;
  const modified = `interface HistoryEntry {
  command: string;
  directory: string;
  exitCode: number | null;
}

export function recentCommands(
  entries: HistoryEntry[],
  directory: string,
) {
  const commands = entries
    .filter(entry => entry.directory === directory)
    .map(entry => entry.command);

  return [...new Set(commands)];
}
`;
  const shared = `
export function recentDirectories(entries: HistoryEntry[]) {
  return [...new Set(entries.map(entry => entry.directory))];
}

export function rememberCommand(
  entries: HistoryEntry[],
  next: HistoryEntry,
) {
  const previous = entries.filter(entry =>
    entry.command !== next.command ||
    entry.directory !== next.directory,
  );

  return [next, ...previous].slice(0, 200);
}
`;
  await page.addInitScript(({ locale }) => {
    localStorage.setItem('vrykell-language', JSON.stringify({ state: { preference: locale }, version: 0 }));
    localStorage.setItem('vrykell-theme-mode', 'dark');
    localStorage.setItem('mock-git-snapshot', JSON.stringify({ root: '/work/atlas', branch: 'feature/history', remotes: ['origin'],
      upstream: 'origin/feature/history', ahead: 2, behind: 0, entries: [
        { path: 'src/session.ts', indexStatus: ' ', worktreeStatus: 'M', previousPath: null },
        { path: 'src/session.test.ts', indexStatus: 'M', worktreeStatus: ' ', previousPath: null },
        { path: 'src/completion.ts', indexStatus: ' ', worktreeStatus: 'M', previousPath: null },
        { path: 'README.md', indexStatus: ' ', worktreeStatus: 'M', previousPath: null },
        { path: 'tests/fixtures/history.json', indexStatus: '?', worktreeStatus: '?', previousPath: null },
      ] }));
  }, { locale });
  await page.goto(origin); await waitForWorkbench(page);
  await page.evaluate(async ({ original, modified }) => {
    document.documentElement.style.clipPath = 'inset(0 round 16px)';
    const { useTypographyStore } = await import('/src/config/typography.ts');
    useTypographyStore.getState().update({ terminalFontSize: 17, editorFontSize: 15, commandHighlighting: true });
    const invoke = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = (command, args, ...rest) => command === 'git_diff'
      ? Promise.resolve({ original, modified, kind: 'text' }) : invoke(command, args, ...rest);
  }, { original: original + shared, modified: modified + shared });
  const shot = async name => {
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(1595, 895); await page.waitForTimeout(400);
    await capture(page, new URL(`${name}-${locale}.png`, directory));
    console.log(`${name}-${locale}.png`);
  };
  if (selectedShots.includes('feature-git')) {
    await page.getByRole('button', { name: locale === 'zh' ? '版本控制' : 'Source control', exact: true }).click();
    const panel = page.getByTestId('git-panel');
    await expect(panel.getByTestId('git-unstaged-src/session.ts')).toBeVisible();
    await panel.getByTestId('git-unstaged-src/session.ts').click();
    await expect(page.getByTestId('git-diff-review').locator('.monaco-diff-editor')).toBeVisible();
    await page.getByTestId('workspace-instance-bar').getByRole('combobox', { name: locale === 'zh' ? '差异布局' : 'Comparison layout' }).click();
    await page.getByRole('option', { name: locale === 'zh' ? '左右对比' : 'Side by side', exact: true }).click();
    await panel.getByRole('textbox', { name: locale === 'zh' ? '提交信息' : 'Commit message', exact: true }).fill('fix: keep command history scoped to its directory');
    await expect(page.getByTestId('git-diff-review').locator('.modified .view-lines:not(.line-delete)')).toContainText('new Set(commands)');
    await shot('feature-git');
    await page.keyboard.press('Control+w');
    await page.getByRole('button', { name: locale === 'zh' ? '版本控制' : 'Source control', exact: true }).click();
  }
  if (selectedShots.includes('feature-completion')) {
    await page.getByTestId('workspace-area-terminal').click();
    await page.evaluate(async () => {
      const { useWorkspaceStore } = await import('/src/features/workspace/stores/workspace.ts');
      if (!useWorkspaceStore.getState().tabs.some(tab => tab.kind === 'session')) useWorkspaceStore.getState().addTab({ shellType: 'zsh', cwd: '/work/atlas' });
    });
    await expect(page.locator('[data-terminal-input]:visible')).toBeVisible();
    await page.evaluate(async () => {
      const { useWorkspaceStore } = await import('/src/features/workspace/stores/workspace.ts');
      const { useBlockStore } = await import('/src/features/terminal/stores/blocks.ts');
      const { useTerminalStore } = await import('/src/features/terminal/stores/terminal.ts');
      const { useHistoryStore } = await import('/src/features/terminal/stores/history.ts');
      const tab = useWorkspaceStore.getState().tabs.find(tab => tab.kind === 'session');
      const paneId = tab.layout.terminal.id;
      const now = Date.now();
      const samples = [
        ['git status --short', ' M src/session.ts\n M src/completion.ts\nM  src/session.test.ts\n?? tests/fixtures/history.json', 0],
        ['npm run test -- src/session.test.ts', ' RUN  tests\n\n ✓ src/session.test.ts (8 tests)\n   ✓ keeps commands from the current directory\n   ✓ keeps interrupted commands in history\n   ✓ removes duplicate suggestions\n\n Test Files  1 passed (1)\n      Tests  8 passed (8)\n   Duration  428ms', 0],
        ['npm run build', 'tsc && vite build\n\n✓ 248 modules transformed.\ndist/index.html          0.64 kB\ndist/assets/app.js     184.32 kB\n\n✓ built in 1.42s', 0],
      ];
      useBlockStore.getState().setBlocks(paneId, samples.map(([command, outputText, exitCode], index) => ({
        id: `core-example-${index}`, command, cwd: '/work/atlas', gitBranch: 'feature/history', status: 'done', exitCode,
        startedAt: now - (samples.length - index) * 5000, endedAt: now - (samples.length - index) * 5000 + 428,
        outputText, outputRaw: outputText.replaceAll('\n', '\r\n'), outputHtml: outputText.replaceAll('\n', '<br>'), linesTruncated: 0,
      })));
      useTerminalStore.setState(state => ({ scenes: { ...state.scenes, [paneId]: 'blockList' } }));
      useHistoryStore.setState({ entries: ['npm run test -- src/session.test.ts', 'npm run test -- --watch', 'npm run test -- --coverage']
        .map(command => ({ command, cwd: '/work/atlas', timestamp: now, exitCode: 0 })) });
    });
    if (selectedShots.includes('feature-completion')) {
      const input = page.locator('[data-terminal-input]:visible');
      await input.fill('npm run t');
      await expect(page.locator('.command-completion-suffix:visible')).toContainText('est -- src/session.test.ts');
      await page.getByRole('button', { name: locale === 'zh' ? '补全快捷键' : 'Completion shortcuts', exact: true }).click();
      await shot('feature-completion');
      await page.keyboard.press('Escape');
    }
  }
  if (selectedShots.includes('theme-deep-black')) {
    await chooseScheme(page, locale, 'dark', 'deep-black');
    await page.keyboard.press('Control+,');
    await page.locator('.settings-navigation').getByRole('button', { name: locale === 'zh' ? '主题' : 'Theme', exact: true }).click();
    await page.getByRole('radio', { name: 'Deep Black', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Deep Black', exact: true })).toBeChecked();
    await shot('theme-deep-black');
  }
  await context.close();
}

try {
  for (const locale of ['zh', 'en']) {
    if (selectedShots?.length && selectedShots.every(name => ['feature-git', 'feature-completion', 'theme-deep-black'].includes(name))) await captureCoreWorkflows(locale);
    else { await scene(locale); if (!extraOnly) await scene(locale, true); }
  }
} finally { await browser.close(); }
for (const item of captures) await saveCapture(item);
