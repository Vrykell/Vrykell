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
  'model.scope.aria': '配置作用域',
  'model.scope.global': '全局默认',
  'settings.save': '保存',

  // ── API Key 提示 ──
  'apiKey.missing': '未配置 API Key，AI 功能不可用',
  'apiKey.placeholder': '输入 Anthropic API Key（sk-ant-...）',
  'apiKey.save': '保存',

  // ── 命令面板 ──
  'palette.search': '搜索命令…',
  'palette.noMatch': '无匹配命令',

  // ── 终端剪贴板 ──
  'terminal.menu.copy': '复制',
  'terminal.menu.paste': '粘贴',
  'terminal.clipboard.copyEmpty': '没有选中内容',
  'terminal.clipboard.copyFailed': '复制失败',
  'terminal.clipboard.pasteFailed': '粘贴失败',
  'terminal.clipboard.noSession': '终端尚未连接，无法粘贴',
  'terminal.processExited': '[进程已退出]',

  // ── SSH 连接页 ──
  'ssh.state.connecting': '正在连接',
  'ssh.state.authenticating': '等待认证',
  'ssh.state.connected': 'SSH 交互会话',
  'ssh.state.disconnected': '连接已断开',
  'ssh.state.authCancelled': '已取消认证，SSH 连接已关闭',
  'ssh.state.manualClosed': '已断开 SSH 连接',
  'ssh.connecting.to': '正在连接 {{target}} …',
  'ssh.input.mode': '输入方式',
  'ssh.input.password': '密码输入',
  'ssh.input.direct': '直接输入',
  'ssh.action.cancelAuth': '取消认证',
  'ssh.action.cancelConnect': '取消连接',
  'ssh.action.disconnect': '断开连接',
  'ssh.action.reconnect': '重新连接',
  'ssh.action.cancelling': '正在取消…',
  'ssh.ended.title': '连接已结束',
  'ssh.ended.exited': 'SSH 进程已退出',
  'ssh.ended.failed': '连接失败',
  'ssh.ended.cancelled': '连接已按你的操作关闭',
  'ssh.ended.lastOutput': '最后输出',
  'ssh.quick.connect': '快速连接',
  'ssh.connected.badge': '已连接',

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
  'files.reveal': '在文件管理器中显示',
  'files.reveal.dir': '在文件管理器中显示当前文件夹',
  'files.loading.directory': '正在读取目录…',
  'files.loading.disks': '正在扫描磁盘…',
  'files.loading.ssh': '正在连接文件服务…',
  'files.error.readDir': '无法读取目录',
  'files.undo.moveOut': '移出',
  'files.undo.result': '已回退{{label}}',
  'files.undo.countSuffix': ' {{n}} 项',
  'files.undo.skipped': '{{base}}，{{n}} 项已不存在（已跳过）',
  'files.undo.failed': '无法回退：{{reason}}（该步已从历史移除）',
  'files.undo.reasonMissing': '目标可能已在别处被移动或删除',
  'files.undo.menu': '回退{{label}}',
  'files.undo.menuSteps': '回退{{label}}（共 {{n}} 步）',
  'files.upload.plainDone': '已上传',
  'files.upload.plainDoneCount': '已上传 {{n}} 项',

  // ── 打开方式设置 ──
  'settings.openMode.title': '各 Shell 打开模式',
  'settings.openMode.description': '经典模式输出直进终端；块模式生成命令块。',
  'settings.openMode.classic': '经典模式',
  'settings.openMode.block': '块模式',
  'settings.openMode.cmdHint': '使用经典模式',
  'settings.openMode.aria': '{{shell}} 打开模式',
  'settings.openMode.sshAria': 'SSH 打开模式',
};

export default zh;
