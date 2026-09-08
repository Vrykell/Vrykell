import { FileText } from 'lucide-react';
import { fmtSize } from '@/components/ui/Button/Button';
import { useWorkspaceDirsStore } from '@/features/files/workspaceDirs';
import { registerSource } from '@/features/search/registry';
import type { FileResultData, SearchResult } from '@/features/search/types';
import { searchFiles as backendSearchFiles } from '@/services/api/search';

function fmtTimeAgo(ts: number): string {
  const ms = Date.now() - ts;
  if (ms < 60000) return '刚刚';
  if (ms < 3600000) return `${Math.floor(ms / 60000)}分前`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}时前`;
  return `${Math.floor(ms / 86400000)}天前`;
}

/** 文件图标统一由 SearchResultCard 依据 FileResultData 渲染（lib/fileIcon） */

registerSource({
  id: 'file',
  label: '文件',
  icon: FileText,
  search: async (query: string): Promise<SearchResult[]> => {
    try {
      // 跨工作区搜索
      const wsDirs = useWorkspaceDirsStore.getState().dirs;
      const roots = wsDirs.length > 0 ? wsDirs.map((d) => d.path) : undefined;
      const files = await backendSearchFiles(query, 50, false, undefined, roots);
      return files.map((f, i) => ({
        type: 'file',
        id: `file-${i}-${f.name}`,
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
    } catch {
      return [];
    }
  },
});
