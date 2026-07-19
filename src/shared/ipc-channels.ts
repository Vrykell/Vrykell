/** IPC channel name constants */

// Main → Renderer
export const IPC_PTY_OUTPUT = 'pty:output';
export const IPC_PTY_EXIT = 'pty:exit';
export const IPC_PTY_TITLE_CHANGE = 'pty:title-change';
export const IPC_SESSION_CREATED = 'session:created';
export const IPC_SESSION_CLOSED = 'session:closed';
export const IPC_SSH_STATUS = 'ssh:status';
export const IPC_AI_RESPONSE = 'ai:response';
export const IPC_APP_MENU_ACTION = 'app:menu-action';

// Renderer → Main
export const IPC_PTY_CREATE = 'pty:create';
export const IPC_PTY_WRITE = 'pty:write';
export const IPC_PTY_RESIZE = 'pty:resize';
export const IPC_PTY_CLOSE = 'pty:close';
export const IPC_SSH_CONNECT = 'ssh:connect';
export const IPC_AI_CHAT = 'ai:chat';
export const IPC_AI_ABORT = 'ai:abort';
export const IPC_SETTINGS_SAVE = 'settings:save';
export const IPC_SETTINGS_LOAD = 'settings:load';
