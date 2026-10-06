/**
 * 简体中文翻译。
 * 键使用点号分隔命名空间，便于按模块分组。
 * 后缀 N 表示带参数（如 `tabs.count` 接受 {{n}}）。
 */
const zh: Record<string, string> = {
  // ── Dock ──
  'dock.tabs': '标签',
  'dock.files': '资源',
  'dock.ssh': 'SSH',
  'dock.chat': 'AI 助手',
  'dock.settings': '设置',
  'dock.dragTip': '拖拽排序或换侧 / 点击{{action}}',
  'dock.open': '打开',
  'dock.close': '关闭',

  // ── 面板 ──
  'panel.newTab': '新建标签',
  'panel.emptyDir': '空目录',
  'panel.goUp': '返回',
  'panel.enterDir': '进入目录',
  'panel.addToInput': '点击追加路径到 AI 输入',

  // ── 状态栏 ──
  'statusBar.shellLocal': '本地 shell',
  'statusBar.tabs.count': '{{n}} 标签',
  'statusBar.version': 'v2',

  // ── 输入栏 ──
  'input.command.placeholder': '输入命令…',
  'input.ai.placeholder': '自然语言描述你想做什么…',

  // ── 终端空状态 ──
  'empty.title1': '在底部输入栏输入命令',
  'empty.title2': 'Enter 执行 · Shift+Enter 换行 · 点击 $ 切换 AI 模式',

  // ── Toast ──
  'toast.tabRestored': '已恢复关闭的标签',
  'toast.renamed': '已重命名为 "{{title}}"',

  // ── 设置 ──
  'settings.title': '设置（⌘,）',
  'settings.apiKeyLabel': 'Anthropic API Key',
  'settings.modelLabel': '模型 ID',
  'settings.save': '保存',

  // ── API Key 提示 ──
  'apiKey.missing': '未配置 API Key，AI 功能不可用',
  'apiKey.placeholder': '输入 Anthropic API Key（sk-ant-...）',
  'apiKey.save': '保存',

  // ── 命令面板 ──
  'palette.search': '搜索命令…',
  'palette.noMatch': '无匹配命令',

  // ── TUI 模式 ──
  'tui.banner': 'TUI 模式 — 键盘直通终端',
  'tui.exit': '退出',

  // ── 查找 ──
  'find.placeholder': '搜索终端输出…',
  'find.close': '关闭',

  // ── 历史面板 ──
  'history.search': '搜索命令历史…',

  // ── 文件管理 ──
  'files.collapseAll': '收起全部文件夹',
  'files.undo.cut': '移动',
  'files.undo.rename': '重命名',
  'files.undo.delete': '删除',
  'files.undo.create': '新建',
  'files.undo.paste': '粘贴',
  'files.undo.upload': '上传',
  'files.upload.start': '正在上传…',
  'files.upload.startCount': '开始上传 {{n}} 项…',
  'files.upload.done': '已上传，可在更多菜单回退',
  'files.upload.doneCount': '已上传 {{n}} 项，可在更多菜单回退',
  'files.dragOut.cancelled': '已取消拖出，已清理临时下载副本',
};

export default zh;
