/** Core shared type definitions */

export type SessionType = 'local' | 'ssh';

export interface SessionInfo {
  id: string;
  type: SessionType;
  title: string;
  cwd?: string;
  shell?: string;
  cols: number;
  rows: number;
  createdAt: number;
  /** SSH-specific fields */
  host?: string;
  username?: string;
}

export interface SessionOptions {
  shell?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
}

export interface SSHConnectOptions {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  tryAgent?: boolean;
}

export interface SavedSSHConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  privateKeyPath?: string;
}

/** Rich output types */
export type RichContentType = 'latex' | 'markdown' | 'code' | 'image' | 'table';

export interface DetectedBlock {
  type: RichContentType;
  content: string;
  language?: string;  // for code blocks
  display?: 'inline' | 'block';  // for LaTeX
  startLine: number;
  endLine: number;
}

export interface RichOutputItem {
  id: string;
  sessionId: string;
  type: RichContentType;
  content: string;
  language?: string;
  display?: 'inline' | 'block';
  html?: string;  // rendered HTML
  timestamp: number;
}

/** AI chat types */
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

/** Application settings */
export interface AppSettings {
  terminal: {
    fontSize: number;
    fontFamily: string;
    cursorStyle: 'block' | 'underline' | 'bar';
    cursorBlink: boolean;
    scrollback: number;
    bellSound: boolean;
  };
  appearance: {
    theme: 'dark' | 'light' | 'high-contrast';
    opacity: number;
    blur: boolean;
  };
  richContent: {
    enableLatex: boolean;
    enableMarkdown: boolean;
    enableCodeHighlight: boolean;
    enableAutoDetect: boolean;
    maxDecorations: number;
  };
  ai: {
    apiKey: string;
    model: string;
    maxContextLines: number;
  };
  ssh: {
    savedConnections: SavedSSHConnection[];
    defaultUsername: string;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  terminal: {
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, monospace",
    cursorStyle: 'block',
    cursorBlink: true,
    scrollback: 10000,
    bellSound: false,
  },
  appearance: {
    theme: 'dark',
    opacity: 1.0,
    blur: false,
  },
  richContent: {
    enableLatex: true,
    enableMarkdown: true,
    enableCodeHighlight: true,
    enableAutoDetect: true,
    maxDecorations: 200,
  },
  ai: {
    apiKey: '',
    model: 'claude-sonnet-5-20251001',
    maxContextLines: 200,
  },
  ssh: {
    savedConnections: [],
    defaultUsername: '',
  },
};
