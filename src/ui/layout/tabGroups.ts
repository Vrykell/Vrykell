export interface TabGroupHandle { id: string; title: string; collapsed: boolean; members: string[]; archivable?: boolean }

/** The strip owns presentation; providers implement the shared group operations. */
export interface TabGroupController {
  groups: TabGroupHandle[];
  order?: string[];
  colors: Record<string, string>;
  create: (tabId: string) => void | Promise<string | undefined>;
  assign: (tabId: string, groupId?: string) => void;
  rename: (id: string, title: string) => void;
  collapse: (id: string, collapsed: boolean) => void;
  remove: (id: string, mode: 'delete' | 'archive') => void;
  color: (id: string, value: string | null) => void;
  move: (id: string, over: string | undefined, after: boolean) => void;
  add?: (id: string) => void;
}
