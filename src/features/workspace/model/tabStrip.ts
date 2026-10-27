import type { TabHandle } from '@ui/layout/tabHandle';
import type { TabGroupController } from '@ui/layout/tabGroups';
import type { ContextMenuItem } from '@ui/menus/ContextMenu';

/** Uniform shape returned by every strip provider. */
export interface WorkspaceTabStrip {
  handles: TabHandle[];
  selected?: string;
  grouping?: TabGroupController;
  onRename?: (id: string, title: string) => void;
  tabActions?: (id: string) => ContextMenuItem[];
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onMove: (id: string, over: string, after: boolean) => void;
}
