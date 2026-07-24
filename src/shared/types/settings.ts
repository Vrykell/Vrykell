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
    savedConnections: import('./session').SavedSSHConnection[];
    defaultUsername: string;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  terminal: {
    fontSize: 14,
    fontFamily: "Menlo, 'DejaVu Sans Mono', 'Courier New', monospace",
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
