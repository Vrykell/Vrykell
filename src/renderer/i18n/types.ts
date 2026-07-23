/** All translatable strings, nested by domain for natural grouping. */
export interface LocaleDict {
  tab: {
    new: string;                  // tooltip for new-tab button
    close: string;                // aria-label for close button
  };
  exit: {
    title: string;                // dialog heading
    message: string;              // explanation text
    confirm: string;              // "close app" button
    cancel: string;               // "keep session" button
  };
  closeTab: {
    title: string;
    message: string;
    confirm: string;
    cancel: string;
  };
  status: {
    sessions: string;             // "{count} session" / "{count} sessions"
    local: string;                // connection type label
  };
  action: {
    newSession: string;
    toggleAI: string;
    toggleOutput: string;
  };
}

/** Supported locale codes.  Add a new value + matching .ts file to add a language. */
export type LocaleCode = 'en' | 'zh';
