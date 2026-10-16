import { test, expect } from '@playwright/test';
import { setupTauriMock, fsOps, revealedPaths, openedPaths, ensureTabsOpen } from './tauri-mock';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  // 打开文件面板
  await page.locator('[data-dock-btn="files"]').click();
  await expect(page.getByText('Documents')).toBeVisible({ timeout: 3000 });
});

test.describe('文件面板', () => {
  test('单击文件仅选中且面板保持打开', async ({ page }) => {
    const file = page.getByTestId('local-file-tree').locator('[data-testid="file-row"][data-path="/home/e2e/notes.txt"]');
    // 单击 = 选中（不打开），文件面板保持打开
    await file.click();
    await expect(file).toHaveAttribute('data-selected', 'true');
    await expect(page.getByText('Documents')).toBeVisible();
  });

  test('单击选中目录，双击进入；展开由箭头按钮控制', async ({ page }) => {
    const tree = page.getByTestId('local-file-tree');
    const documents = tree.locator('[data-testid="file-row"][data-path="/home/e2e/Documents"]');
    // 单击 = 选中，不展开
    await documents.click();
    await expect(documents).toHaveAttribute('data-selected', 'true');
    await expect(tree.getByText('Documents')).toHaveCount(1);
    // 展开交给箭头按钮（mock 对每个路径返回相同子项，展开后 Documents 出现两个）
    await documents.locator('[data-testid="file-row-expander"]').click();
    await expect(tree.getByText('Documents')).toHaveCount(2);
    // 双击 = 进入文件夹，回退按钮变为可用
    await documents.first().dblclick();
    await expect(page.getByTestId('local-back-btn')).toBeEnabled();
  });

  test('上下键切换选中行，Enter 进入目录', async ({ page }) => {
    const tree = page.getByTestId('local-file-tree');
    const documents = tree.locator('[data-testid="file-row"][data-path="/home/e2e/Documents"]');
    const downloads = tree.locator('[data-testid="file-row"][data-path="/home/e2e/Downloads"]');
    // 点击行让文件列表获得焦点并选中 Documents
    await documents.click();
    await expect(documents).toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(downloads).toHaveAttribute('data-selected', 'true');
    await expect(documents).not.toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('ArrowUp');
    await expect(documents).toHaveAttribute('data-selected', 'true');
    // Enter = 进入选中目录，回退按钮变为可用
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('local-back-btn')).toBeEnabled();
  });

  test('面包屑可编辑：点击路径全选，回车跳转，Esc 或失焦取消', async ({ page }) => {
    const tree = page.getByTestId('local-file-tree');
    const bar = page.getByTestId('crumb-bar');
    const input = page.getByTestId('path-input');
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/project');

    // 点击当前路径进入编辑态：显示完整路径并且文本全选
    await bar.locator('[data-tip="单击编辑路径，回车跳转"]').click();
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('/home/e2e/project');
    await input.fill('/home/e2e/Documents');
    await input.press('Enter');
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/Documents');
    await expect(input).toHaveCount(0);

    // Esc 取消编辑，路径不变
    await bar.locator('[data-tip="单击编辑路径，回车跳转"]').click();
    await expect(input).toHaveValue('/home/e2e/Documents');
    await input.press('Escape');
    await expect(input).toHaveCount(0);
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/Documents');

    // 失焦取消编辑，路径不变
    await bar.locator('[data-tip="单击编辑路径，回车跳转"]').click();
    await input.fill('/home/e2e/Downloads');
    await tree.getByText('notes.txt').click();
    await expect(input).toHaveCount(0);
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/Documents');
  });

  test('路径栏输入文件路径用系统默认应用打开，目录路径仍然导航', async ({ page }) => {
    const tree = page.getByTestId('local-file-tree');
    const bar = page.getByTestId('crumb-bar');
    await bar.locator('[data-tip="单击编辑路径，回车跳转"]').click();
    await page.getByTestId('path-input').fill('/home/e2e/notes.txt');
    await page.getByTestId('path-input').press('Enter');

    // The system app receives the file path; the panel keeps its view and shows no read error
    await expect.poll(() => openedPaths(page)).toContain('/home/e2e/notes.txt');
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/project');
    await expect(page.getByRole('alert')).toHaveCount(0);

    // Directory paths keep navigating as before
    await bar.locator('[data-tip="单击编辑路径，回车跳转"]').click();
    await page.getByTestId('path-input').fill('/home/e2e/Documents');
    await page.getByTestId('path-input').press('Enter');
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/Documents');
  });

  test('右键属性显示文件基本信息', async ({ page }) => {
    await page.locator('[data-testid="file-row"][data-path="/home/e2e/notes.txt"]').click({ button: 'right' });
    await page.getByRole('button', { name: '属性', exact: true }).click();

    const dialog = page.getByTestId('file-properties-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('file-property-name')).toHaveText('notes.txt');
    await expect(page.getByTestId('file-property-type')).toHaveText('TXT 文件');
    await expect(page.getByTestId('file-property-location')).toHaveText('/home/e2e');
    await expect(page.getByTestId('file-property-size')).toHaveText('1.5 KB');
    await expect(page.getByTestId('file-property-modified')).toContainText('2026');

    await page.getByTestId('properties-close').click();
    await expect(dialog).toHaveCount(0);
  });

  test('更多菜单：只提供本地可用操作，可从当前文件夹新建标签页', async ({ page }) => {
    const tree = page.getByTestId('local-file-tree');
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/project');

    // 本地没有上传能力，更多菜单不出现上传项
    await page.getByTestId('local-more-btn').click();
    await expect(page.getByRole('button', { name: '上传文件' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '下载管理' })).toBeVisible();
    // 没有进行过文件操作时不出现回退项
    await expect(page.getByRole('button', { name: /^回退/ })).toHaveCount(0);

    // 从当前文件夹新建标签页（标题取目录名）
    await page.getByRole('button', { name: '从当前文件夹新建标签页' }).click();
    await ensureTabsOpen(page);
    await expect(page.locator('[data-testid^="tab-row-"]', { hasText: 'project' })).toHaveCount(1);

    // 切回文件面板；盘符视图没有「当前文件夹」，菜单里不出现不可用的新建标签页
    await page.locator('[data-dock-btn="files"]').click();
    await expect(tree).toBeVisible();
    await page.getByText('此电脑').click();
    await expect(page.getByTestId('disk-card-e2e-root')).toBeVisible({ timeout: 3000 });
    await page.getByTestId('local-more-btn').click();
    await expect(page.getByRole('button', { name: '从当前文件夹新建标签页' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '下载管理' })).toBeVisible();
  });

  test('更多菜单：切换到当前终端文件目录把面板重新定位回终端 cwd', async ({ page }) => {
    const tree = page.getByTestId('local-file-tree');
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/project');

    // 进入子目录：面板与终端解耦（不再自动跟随）
    await tree.locator('[data-testid="file-row"][data-path="/home/e2e/Documents"]').dblclick();
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/Documents');

    // 更多 → 同步到终端目录：面板回到终端的 cwd
    await page.getByTestId('local-more-btn').click();
    await page.getByRole('button', { name: '切换到当前终端文件目录', exact: true }).click();
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/project');
  });

  test('Ctrl 加选多行并在右键菜单批量操作', async ({ page }) => {
    const tree = page.getByTestId('local-file-tree');
    const notes = tree.locator('[data-testid="file-row"][data-path="/home/e2e/notes.txt"]');
    const documents = tree.locator('[data-testid="file-row"][data-path="/home/e2e/Documents"]');

    await notes.click();
    await expect(notes).toHaveAttribute('data-selected', 'true');
    await documents.click({ modifiers: ['ControlOrMeta'] });
    await expect(documents).toHaveAttribute('data-selected', 'true');
    await expect(notes).toHaveAttribute('data-selected', 'true');

    // 右键命中选中集：菜单作用于整组，并隐藏只对单行有意义的操作
    await notes.click({ button: 'right' });
    await expect(page.getByRole('button', { name: '复制 2 项' })).toBeVisible();
    await expect(page.getByRole('button', { name: '删除 2 项' })).toBeVisible();
    await expect(page.getByRole('button', { name: '重命名' })).toHaveCount(0);
  });

  test('粘贴目标：右键文件夹进该文件夹，右键文件进其同级目录，Ctrl+V 进当前目录', async ({ page }) => {
    const tree = page.getByTestId('local-file-tree');
    const notes = tree.locator('[data-testid="file-row"][data-path="/home/e2e/notes.txt"]');

    // 复制 → 右键文件夹：粘贴进该文件夹
    await notes.click({ button: 'right' });
    await page.getByRole('button', { name: '复制', exact: true }).click();
    await tree.locator('[data-testid="file-row"][data-path="/home/e2e/Documents"]').click({ button: 'right' });
    await page.getByRole('button', { name: '粘贴', exact: true }).click();
    await expect.poll(async () => (await fsOps(page)).filter((op) => op.op === 'copy'))
      .toContainEqual({ op: 'copy', path: '/home/e2e/notes.txt', destDir: '/home/e2e/Documents' });

    // 右键文件：粘贴到该文件的同级目录（不是当前目录）
    await notes.click({ button: 'right' });
    await page.getByRole('button', { name: '粘贴', exact: true }).click();
    await expect.poll(async () => (await fsOps(page)).filter((op) => op.op === 'copy'))
      .toContainEqual({ op: 'copy', path: '/home/e2e/notes.txt', destDir: '/home/e2e' });

    // 空白处右键：粘贴到当前目录
    const box = await tree.boundingBox();
    await page.mouse.click(box!.x + 40, box!.y + box!.height - 20, { button: 'right' });
    await expect(page.getByRole('button', { name: '粘贴', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    // Ctrl+V：粘贴到当前目录
    await notes.click();
    await page.keyboard.press('ControlOrMeta+v');
    await expect.poll(async () => (await fsOps(page)).filter((op) => op.op === 'copy'))
      .toContainEqual({ op: 'copy', path: '/home/e2e/notes.txt', destDir: '/home/e2e/project' });
  });

  test('删除后可连续回退：历史栈支持多次回退', async ({ page }) => {
    const tree = page.getByTestId('local-file-tree');
    const notes = tree.locator('[data-testid="file-row"][data-path="/home/e2e/notes.txt"]');
    const documents = tree.locator('[data-testid="file-row"][data-path="/home/e2e/Documents"]');

    // 连续删除两次：历史栈保留两步
    await notes.click({ button: 'right' });
    await page.getByRole('button', { name: '删除', exact: true }).click();
    await page.locator('[data-testid="confirm-ok"]').click();
    await expect.poll(async () => (await fsOps(page)).filter((op) => op.op === 'delete'))
      .toContainEqual({ op: 'delete', path: '/home/e2e/notes.txt' });
    await documents.click({ button: 'right' });
    await page.getByRole('button', { name: '删除', exact: true }).click();
    await page.locator('[data-testid="confirm-ok"]').click();
    await expect.poll(async () => (await fsOps(page)).filter((op) => op.op === 'delete'))
      .toContainEqual({ op: 'delete', path: '/home/e2e/Documents' });

    // 更多菜单显示剩余步数，连续回退两次把两步都还原
    await page.getByTestId('local-more-btn').click();
    await page.getByRole('button', { name: /^回退删除/ }).click();
    await expect.poll(async () => (await fsOps(page)).filter((op) => op.op === 'restore'))
      .toContainEqual({ op: 'restore', path: '/home/e2e/Documents' });
    await page.getByTestId('local-more-btn').click();
    await page.getByRole('button', { name: /^回退删除/ }).click();
    await expect.poll(async () => (await fsOps(page)).filter((op) => op.op === 'restore'))
      .toContainEqual({ op: 'restore', path: '/home/e2e/notes.txt' });
    // 栈清空后不再显示回退项
    await page.getByTestId('local-more-btn').click();
    await expect(page.getByRole('button', { name: /^回退/ })).toHaveCount(0);
  });

  test('拖拽文件到文件夹：悬停高亮并移动', async ({ page }) => {
    const tree = page.getByTestId('local-file-tree');
    const notes = tree.locator('[data-testid="file-row"][data-path="/home/e2e/notes.txt"]');
    const documents = tree.locator('[data-testid="file-row"][data-path="/home/e2e/Documents"]');

    const from = await notes.boundingBox();
    const to = await documents.boundingBox();
    await page.mouse.move(from!.x + 40, from!.y + from!.height / 2);
    await page.mouse.down();
    await page.mouse.move(to!.x + 40, to!.y + to!.height / 2, { steps: 8 });
    // 拖拽预览显示被拖文件的图标（不再显示文字说明）
    await expect(page.getByTestId('file-drag-preview')).toBeVisible();
    await page.mouse.up();

    await expect.poll(async () => (await fsOps(page)).filter((op) => op.op === 'move'))
      .toContainEqual({ op: 'move', path: '/home/e2e/notes.txt', destDir: '/home/e2e/Documents' });
  });

  test('此电脑视图：磁盘以小卡片展示（含容量），点击进入', async ({ page }) => {
    // 点击面包屑「此电脑」进入磁盘视图
    await page.getByText('此电脑').click();
    await expect(page.locator('[data-testid="disk-card-e2e-root"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('[data-testid="disk-card-Backup"]')).toBeVisible();
    // 卡片展示容量信息（250 GB 可用）
    await expect(page.getByText('250 GB 可用')).toBeVisible();
    // 点击磁盘卡片进入该磁盘根目录（文件列表出现）
    await page.locator('[data-testid="disk-card-e2e-root"]').click();
    await expect(page.getByText('Documents')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('[data-testid="disk-card-e2e-root"]')).toHaveCount(0);
  });

  test('关闭面板再重新打开', async ({ page }) => {
    // 关闭面板——再点一次 dock 按钮
    await page.locator('[data-dock-btn="files"]').click();
    await expect(page.getByText('Documents')).toBeHidden();
    // 重新打开
    await page.locator('[data-dock-btn="files"]').click();
    await expect(page.getByText('Documents')).toBeVisible({ timeout: 3000 });
  });

  test('拖拽到最小宽度立即折叠；松手前可反悔拖回', async ({ page }) => {
    await expect(page.getByText('Documents')).toBeVisible();
    // Drag the right edge left to reduce the file sidebar width.
    const handle = page.locator('[data-testid="resize-handle-files"]');
    await expect(handle).toBeVisible();
    const box = await handle.boundingBox();
    const cy = (box?.y ?? 0) + (box?.height ?? 0) / 2;
    const cx = (box?.x ?? 0) + (box?.width ?? 0) / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    // 第 5 步（80px）到下限 → 立即折叠（内容隐藏但保持挂载，状态不丢），之后保持收起
    for (let i = 0; i < 8; i++) {
      await page.mouse.move(cx - (i + 1) * 16, cy);
      await page.waitForTimeout(12);
      if (i >= 5) {
        await expect(page.getByText('Documents')).toBeHidden();
      }
    }
    // Drag right before releasing to restore the same mounted panel.
    for (let i = 0; i < 8; i++) {
      await page.mouse.move(cx - (8 - i) * 16, cy);
      await page.waitForTimeout(12);
    }
    await expect(page.getByText('Documents')).toBeVisible({ timeout: 3000 });
    // 松手定局：保持展开
    await page.mouse.up();
    await expect(page.getByText('Documents')).toBeVisible();
    // 再拖到折叠并直接松手 → 折叠保持；点 Dock 按钮恢复
    // （宽度已变，手柄位置随之移动，需重新定位）
    const box2 = await handle.boundingBox();
    const cx2 = (box2?.x ?? 0) + (box2?.width ?? 0) / 2;
    await page.mouse.move(cx2, cy);
    await page.mouse.down();
    for (let i = 0; i < 8; i++) {
      await page.mouse.move(cx2 - (i + 1) * 16, cy);
      await page.waitForTimeout(12);
    }
    await page.mouse.up();
    await expect(page.getByText('Documents')).toBeHidden();
    await page.locator('[data-dock-btn="files"]').click();
    await expect(page.getByText('Documents')).toBeVisible({ timeout: 3000 });
  });

  test('拖动折叠后反向拖回：面板内部状态不丢失（未重新加载）', async ({ page }) => {
    // 进入目录（改变面板内部路径状态）：双击目录
    const tree = page.getByTestId('local-file-tree');
    const documents = tree.locator('[data-testid="file-row"][data-path="/home/e2e/Documents"]');
    await documents.dblclick();
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/Documents');
    // 拖到折叠（不松手）
    const handle = page.locator('[data-testid="resize-handle-files"]');
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    const cy = (box!.y ?? 0) + (box!.height ?? 0) / 2;
    const cx = (box!.x ?? 0) + (box!.width ?? 0) / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 0; i < 8; i++) {
      await page.mouse.move(cx - (i + 1) * 16, cy);
      await page.waitForTimeout(12);
    }
    await expect(page.getByTestId('local-back-btn')).toBeHidden();
    // 反向拖回并松手 → 面板恢复，且仍停留在之前进入的目录（状态未丢、未 reload）
    for (let i = 0; i < 8; i++) {
      await page.mouse.move(cx - (8 - i) * 16, cy);
      await page.waitForTimeout(12);
    }
    await page.mouse.up();
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/Documents');
    await expect(page.getByTestId('local-back-btn')).toBeVisible({ timeout: 3000 });
  });

  test('删除文件需二次确认，确认后调用后端删除（回收站）', async ({ page }) => {
    await page.getByText('notes.txt').click({ button: 'right' });
    await page.getByRole('button', { name: '删除' }).click();
    await expect(page.locator('[data-testid="confirm-dialog"]')).toBeVisible();
    await expect(page.getByText('确认删除')).toBeVisible();
    await page.locator('[data-testid="confirm-ok"]').click();
    const ops = await fsOps(page);
    expect(ops).toContainEqual({ op: 'delete', path: '/home/e2e/notes.txt' });
  });

  test('重命名为侧栏内联编辑，回车后确认', async ({ page }) => {
    await page.getByText('notes.txt').click({ button: 'right' });
    await page.getByRole('button', { name: '重命名' }).click();
    // 内联输入框出现，而非弹窗
    const input = page.locator('[data-testid="rename-input"]');
    await expect(input).toBeVisible();
    await expect(page.locator('[data-testid="prompt-input"]')).toHaveCount(0);
    await input.fill('renamed.txt');
    await input.press('Enter');
    await expect(page.locator('[data-testid="confirm-dialog"]')).toBeVisible();
    await expect(page.getByText('确认重命名')).toBeVisible();
    await page.locator('[data-testid="confirm-ok"]').click();
    const ops = await fsOps(page);
    expect(ops).toContainEqual({ op: 'rename', path: '/home/e2e/notes.txt', newName: 'renamed.txt' });
  });

  test('空白处右键菜单与 ⋯ 菜单列出同一套操作', async ({ page }) => {
    const tree = page.getByTestId('local-file-tree');
    const menu = page.getByRole('menu', { name: '操作菜单' });
    const menuItems = () => menu.evaluate((el) => [...el.querySelectorAll('button')]
      .map((button) => (button as HTMLElement).innerText.trim()).filter(Boolean));

    await page.getByTestId('local-more-btn').click();
    const fromMore = await menuItems();
    await page.keyboard.press('Escape');
    expect(fromMore.length).toBeGreaterThan(0);

    const box = (await tree.boundingBox())!;
    await page.mouse.click(box.x + 40, box.y + box.height - 12, { button: 'right' });
    await expect(menu).toBeVisible();
    // 空白处不再缺项：⋯ 菜单有的这里都有（剪贴板为空时不多出「粘贴」）
    expect(await menuItems()).toEqual(fromMore);
    await expect(menu.getByRole('button', { name: '下载管理', exact: true })).toBeVisible();
    await expect(menu.getByRole('button', { name: '收起全部文件夹', exact: true })).toBeVisible();
    await expect(menu.getByRole('button', { name: '切换到当前终端文件目录', exact: true })).toBeVisible();
  });

  test('右键新建按落点决定目录，建好立即重命名，重名自动加序号且回退用真实路径', async ({ page }) => {
    const tree = page.getByTestId('local-file-tree');
    /** 面板空白处右键（用元素范围定位，避免落到行上） */
    const rightClickBlank = async () => {
      const box = (await tree.boundingBox())!;
      await page.mouse.click(box.x + 40, box.y + box.height - 12, { button: 'right' });
    };
    // 空白处右键 → 新建文件夹落在当前目录
    await rightClickBlank();
    await page.getByRole('button', { name: '新建文件夹', exact: true }).click();
    const input = page.locator('[data-testid="rename-input"]');
    await expect(input).toHaveValue('NewFolder');
    expect(await fsOps(page)).toContainEqual({ op: 'create-dir', path: '/home/e2e/project/NewFolder' });
    await input.press('Enter');   // 名称未变：不产生重命名请求
    expect(await fsOps(page)).not.toContainEqual(expect.objectContaining({ op: 'rename' }));

    // 右键文件行 → 新建文件落在该文件的同级目录
    await page.getByText('notes.txt').click({ button: 'right' });
    await page.getByRole('button', { name: '新建文件', exact: true }).click();
    await expect(input).toHaveValue('Untitled');
    expect(await fsOps(page)).toContainEqual({ op: 'create-file', path: '/home/e2e/Untitled' });

    // 改成已存在的名字：后端避让为 notes (1).txt（序号在扩展名前），回退记录必须用真实路径
    await input.fill('notes.txt');
    await input.press('Enter');
    await page.locator('[data-testid="confirm-ok"]').click();
    await expect(page.getByText('已重命名')).toBeVisible();

    await page.getByTestId('local-more-btn').click();
    await page.getByRole('button', { name: /回退重命名/ }).click();
    await expect(page.getByText('已回退重命名')).toBeVisible();
    expect(await fsOps(page)).toContainEqual({ op: 'rename', path: '/home/e2e/notes (1).txt', newName: 'Untitled' });
  });

  test('新建与复制粘贴都能回退（回退新建 / 回退粘贴）', async ({ page }) => {
    const tree = page.getByTestId('local-file-tree');
    const box = (await tree.boundingBox())!;
    // 新建文件 → 更多菜单出现「回退新建」
    await page.mouse.click(box.x + 40, box.y + box.height - 12, { button: 'right' });
    await page.getByRole('button', { name: '新建文件', exact: true }).click();
    await page.locator('[data-testid="rename-input"]').press('Escape');
    await page.getByTestId('local-more-btn').click();
    await page.getByRole('button', { name: /回退新建/ }).click();
    await expect(page.getByText('已回退新建')).toBeVisible();
    expect(await fsOps(page)).toContainEqual({ op: 'delete', path: '/home/e2e/project/Untitled' });

    // 复制同名文件到当前目录 → 回退粘贴移除复制出来的那一份
    await page.getByText('notes.txt').first().click({ button: 'right' });
    await page.getByRole('button', { name: '复制', exact: true }).click();
    await page.mouse.click(box.x + 40, box.y + box.height - 12, { button: 'right' });
    await page.getByRole('button', { name: '粘贴', exact: true }).click();
    await expect(page.getByText('已复制 1 项（同名已自动加序号）')).toBeVisible();
    await page.getByTestId('local-more-btn').click();
    await page.getByRole('button', { name: /回退粘贴/ }).click();
    await expect(page.getByText('已回退粘贴')).toBeVisible();
    expect(await fsOps(page)).toContainEqual({ op: 'delete', path: '/home/e2e/project/notes (1).txt' });
  });

  test('右键文件夹新建文件：落在文件夹内、立即重命名，提交后子列表可见', async ({ page }) => {
    await page.getByText('Documents').first().click({ button: 'right' });
    await page.getByRole('button', { name: '新建文件', exact: true }).click();
    const input = page.locator('[data-testid="rename-input"]');
    await expect(input).toHaveValue('Untitled');
    expect(await fsOps(page)).toContainEqual({ op: 'create-file', path: '/home/e2e/Documents/Untitled' });

    await input.fill('plan.md');
    await input.press('Enter');
    await page.locator('[data-testid="confirm-ok"]').click();
    await expect(page.getByText('已重命名')).toBeVisible();
    expect(await fsOps(page)).toContainEqual({ op: 'rename', path: '/home/e2e/Documents/Untitled', newName: 'plan.md' });
    // 目标文件夹已自动展开，新条目出现在它的子列表里（mock 会把新建条目同时列在多处，取第一个）
    await expect(page.locator('[data-testid="file-row"][data-path="/home/e2e/Documents/Untitled"]').first()).toBeVisible();
  });

  test('新建同名项时后端避让加序号，仍会立即进入重命名', async ({ page }) => {
    const input = page.locator('[data-testid="rename-input"]');

    // 第一次新建默认名，Esc 取消重命名（条目保留在目录里）
    await page.getByTestId('local-more-btn').click();
    await page.getByRole('button', { name: '新建文件', exact: true }).click();
    await expect(input).toHaveValue('Untitled');
    await input.press('Escape');

    // 第二次新建同名 → 后端避让为 Untitled (1)，仍要立刻进入重命名
    await page.getByTestId('local-more-btn').click();
    await page.getByRole('button', { name: '新建文件', exact: true }).click();
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('Untitled (1)');
  });

  test('右键行与更多菜单都能在系统文件管理器中定位', async ({ page }) => {
    const tree = page.getByTestId('local-file-tree');
    const notes = tree.locator('[data-testid="file-row"][data-path="/home/e2e/notes.txt"]');

    // 行右键：定位该条目
    await notes.click({ button: 'right' });
    await page.getByRole('button', { name: '在文件管理器中显示' }).click();
    await expect.poll(() => revealedPaths(page)).toContain('/home/e2e/notes.txt');

    // ⋯ 菜单：定位当前文件夹
    const currentDir = await tree.getAttribute('data-path');
    await page.getByTestId('local-more-btn').click();
    await page.getByRole('button', { name: '在文件管理器中显示当前文件夹' }).click();
    await expect.poll(() => revealedPaths(page)).toContain(currentDir);
  });

  test('更多菜单可直接在当前文件夹新建文件/文件夹', async ({ page }) => {
    const input = page.locator('[data-testid="rename-input"]');

    await page.getByTestId('local-more-btn').click();
    await page.getByRole('button', { name: '新建文件夹', exact: true }).click();
    await expect(input).toHaveValue('NewFolder');
    expect(await fsOps(page)).toContainEqual({ op: 'create-dir', path: '/home/e2e/project/NewFolder' });
    await input.press('Escape');

    await page.getByTestId('local-more-btn').click();
    await page.getByRole('button', { name: '新建文件', exact: true }).click();
    await expect(input).toHaveValue('Untitled');
    expect(await fsOps(page)).toContainEqual({ op: 'create-file', path: '/home/e2e/project/Untitled' });
    await input.press('Escape');
  });

  test('复制同名文件到当前目录：自动加序号并在提示中说明', async ({ page }) => {
    await page.getByText('notes.txt').first().click({ button: 'right' });
    await page.getByRole('button', { name: '复制', exact: true }).click();
    const tree = page.getByTestId('local-file-tree');
    const box = (await tree.boundingBox())!;
    await page.mouse.click(box.x + 40, box.y + box.height - 12, { button: 'right' });
    await page.getByRole('button', { name: '粘贴', exact: true }).click();
    await expect(page.getByText('已复制 1 项（同名已自动加序号）')).toBeVisible();
    expect(await fsOps(page)).toContainEqual({ op: 'copy', path: '/home/e2e/notes.txt', destDir: '/home/e2e/project' });
  });

  test('本地面板的菜单不含远程专有项', async ({ page }) => {
    await page.getByText('Documents').first().click({ button: 'right' });
    await expect(page.getByRole('button', { name: '在新标签页中打开' })).toBeVisible();
    await expect(page.getByRole('button', { name: /下载.*到本地/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '上传文件', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.getByTestId('local-more-btn').click();
    await expect(page.getByRole('button', { name: '从当前文件夹新建标签页' })).toBeVisible();
    await expect(page.getByRole('button', { name: '下载管理' })).toBeVisible();
    await expect(page.getByRole('button', { name: '上传文件', exact: true })).toHaveCount(0);
  });
});
