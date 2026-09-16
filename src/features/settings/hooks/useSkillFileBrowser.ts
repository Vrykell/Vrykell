import { useCallback, useEffect, useMemo, useState } from 'react';
import { readSkillFile } from '@features/agent/services/skills';
import { buildFileTree, type FileNode } from '@features/settings/model/skillFileTree';

interface UseSkillFileBrowserOptions {
  skillName: string;
  files: string[];
}

/** 管理技能详情中的文件树展开、选中和文件内容读取。 */
export function useSkillFileBrowser({ skillName, files }: UseSkillFileBrowserOptions) {
  const tree = useMemo(() => buildFileTree(files), [files]);
  const filesKey = files.join('\u0000');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState('');

  useEffect(() => {
    setOpen(new Set());
    setSelected(null);
    setContent('');
  }, [filesKey, skillName]);

  const pick = useCallback(async (node: FileNode) => {
    if (node.isDir) {
      setOpen((previous) => {
        const next = new Set(previous);
        if (next.has(node.path)) next.delete(node.path);
        else next.add(node.path);
        return next;
      });
      return;
    }
    setSelected(node.path);
    try {
      setContent(await readSkillFile(skillName, node.path));
    } catch (error) {
      setContent(`读取失败：${(error as Error)?.message ?? error}`);
    }
  }, [skillName]);

  return { tree, open, selected, content, pick };
}
