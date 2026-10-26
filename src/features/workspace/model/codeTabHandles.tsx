import { editorFileKey, type EditorFile } from '@core/editor';
import { t } from '@i18n';
import { fileIcon } from '@features/files';
import { isDocumentDirty, type DocumentState } from '@features/editor/stores/documents';
import { iconSizes } from '@ui/icons';
import { tabCapabilities, type TabHandle } from '@ui/layout/tabHandle';
import type { Tab } from '../stores/workspace';
import { orderProjected } from './tabStrip';

export type CodeTabTarget =
  | { handle: TabHandle; file: EditorFile }
  | { handle: TabHandle; comparisonId: string };

/**
 * Project editor files and git comparisons into one ordered strip.
 *
 * A code row is either a file inside an editor page or one comparison inside a review page;
 * neither maps one-to-one to a `Tab`, so the handle carries the row identity.
 */
export function projectCodeTabs(tabs: Tab[], documents: Record<string, DocumentState>, order: string[]): CodeTabTarget[] {
  const targets: CodeTabTarget[] = [];
  for (const tab of tabs) {
    if (tab.kind === 'editor') {
      for (const file of tab.files) {
        const key = editorFileKey(file);
        const dirty = isDocumentDirty(documents[key]);
        const Icon = fileIcon(file.path);
        targets.push({
          file,
          handle: {
            id: `file:${key}`,
            label: `${file.path.split(/[\\/]/).pop()}${dirty ? ' •' : ''}`,
            tip: file.path,
            icon: <Icon size={iconSizes.compact} />,
            closeLabel: t('Close file {{path}}', { path: file.path }),
            capabilities: tabCapabilities(),
          },
        });
      }
      continue;
    }
    if (tab.kind === 'git-diff') {
      for (const item of tab.comparisons ?? [{ id: tab.id, selection: tab.selection }]) {
        const Icon = fileIcon(item.selection.path);
        targets.push({
          comparisonId: item.id,
          handle: {
            id: `diff:${item.id}`,
            label: `${item.selection.path.split(/[\\/]/).pop()} · ${t(item.selection.scope === 'staged' ? 'Staged changes' : 'File comparison')}`,
            tip: `${item.selection.target.cwd}/${item.selection.path}`,
            icon: <Icon size={iconSizes.compact} />,
            closeLabel: t('Close comparison {{path}}', { path: item.selection.path }),
            capabilities: tabCapabilities(),
          },
        });
      }
    }
  }
  return orderProjected(targets, order);
}
