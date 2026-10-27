import { FileText } from '@ui/icons';
import { registerSource } from '@features/search/services/registry';
import { searchFiles as backendSearchFiles } from '@platform/api/search';
import { useWorkspaceDirsStore } from '@features/files/services/workspaceDirs';
import { fmtSize } from '@ui/actions/UiBtn';
import { t } from '@i18n';
import type { SearchResult, FileResultData } from '@features/search/types';
import type { BackendFileMatch } from '@platform/api/types';

function fmtTimeAgo(ts: number): string {
  const ms = Date.now() - ts;
  if (ms < 60000) return t('Just now');
  if (ms < 3600000) return t('{{count}} min ago', { count: Math.floor(ms / 60000) });
  if (ms < 86400000) return t('{{count}} h ago', { count: Math.floor(ms / 3600000) });
  return t('{{count}} d ago', { count: Math.floor(ms / 86400000) });
}

/** File icons are rendered uniformly by SearchResultCard from FileResultData (lib/fileIcon) */

registerSource({
  id: 'file',
  label: t('Files'),
  icon: FileText,
  search: async (query, options): Promise<SearchResult[]> => {
    try {
      // Search across workspaces
      const wsDirs = useWorkspaceDirsStore.getState().dirs;
      const roots = wsDirs.length > 0 ? wsDirs.map((d) => d.path) : undefined;
      const mapFiles = (files: BackendFileMatch[]): SearchResult[] => files.map(f => ({
        type: 'file',
        id: `file-${f.path}`,
        title: f.name,
        subtitle: f.path,
        detail: f.modified ? `${fmtTimeAgo(f.modified)} · ${fmtSize(f.size)}` : undefined,
        data: {
          name: f.name,
          path: f.path,
          isDir: f.is_dir,
          size: f.size,
          modified: f.modified,
          matchType: (f.match_type ?? 'name') as FileResultData['matchType'],
          contentSnippet: f.content_snippet ?? undefined,
        } as FileResultData,
      }));
      const files = await backendSearchFiles(query, 50, false, undefined, roots,
        options ? { signal: options.signal, onProgress: files => options.onProgress(mapFiles(files)) } : undefined);
      return mapFiles(files);
    } catch {
      return [];
    }
  },
});
