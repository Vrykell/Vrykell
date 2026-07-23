import type { LocaleDict } from './types';

const zh: LocaleDict = {
  tab: {
    new: '新建终端 (Ctrl+T)',
    close: '关闭',
  },
  exit: {
    title: '关闭 AI Terminal',
    message: '当前是最后一个会话，关闭将退出应用程序。\n确定要退出吗？',
    confirm: '退出程序',
    cancel: '保留会话',
  },
  closeTab: {
    title: '关闭终端',
    message: '该终端中有正在运行的程序，关闭将强制终止。\n确定要关闭吗？',
    confirm: '强制关闭',
    cancel: '取消',
  },
  status: {
    sessions: '{count} 个会话',
    local: '本地',
  },
  action: {
    newSession: '新建终端',
    toggleAI: '切换 AI 面板',
    toggleOutput: '切换富文本输出',
  },
};

export default zh;
