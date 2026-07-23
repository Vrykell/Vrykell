import type { LocaleDict } from './types';

const en: LocaleDict = {
  tab: {
    new: 'New Terminal (Ctrl+T)',
    close: 'Close',
  },
  exit: {
    title: 'Close AI Terminal',
    message:
      'This is the last session. Closing it will exit the application.\nAre you sure?',
    confirm: 'Close App',
    cancel: 'Keep Session',
  },
  closeTab: {
    title: 'Close Terminal',
    message:
      'A program is running in this terminal. Closing it will terminate the process.\nAre you sure?',
    confirm: 'Force Close',
    cancel: 'Cancel',
  },
  status: {
    sessions: '{count} session',
    local: 'Local',
  },
  action: {
    newSession: 'New Terminal',
    toggleAI: 'Toggle AI Panel',
    toggleOutput: 'Toggle Rich Output',
  },
};

export default en;
