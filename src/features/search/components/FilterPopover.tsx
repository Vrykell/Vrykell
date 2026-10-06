import CheckboxMenu from '@ui/CheckboxMenu';
import type { ResultType } from '@features/search/types';
import { getSources, useEnabledSourcesStore, toggleSource } from '@features/search/services/registry';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 各源的实时匹配数 */
  counts: Partial<Record<ResultType, number>>;
}

/** 搜索范围筛选：多选列表，逐项切换后保持展开，失去焦点才关闭。 */
export default function FilterPopover({ open, onClose, counts }: Props) {
  // 必须在 early return 之前调用（React hooks 顺序稳定，否则切换 open 时崩溃）
  const enabled = useEnabledSourcesStore((s) => s.enabledIds);
  if (!open) return null;

  const sources = getSources();
  const allEnabled = sources.every((s) => enabled.has(s.id));

  function handleToggle(id: ResultType) {
    const currentlyEnabled = enabled.has(id);
    // 如果全部启用中，切换单个 → 只保留这个
    if (allEnabled && currentlyEnabled) {
      for (const s of sources) {
        if (s.id !== id) toggleSource(s.id, false);
      }
    }
    toggleSource(id, !currentlyEnabled);
  }

  return (
    <CheckboxMenu
      title="搜索范围"
      onClose={onClose}
      onToggle={handleToggle}
      style={{ top: '100%', right: 0, marginTop: 4, width: 200 }}
      options={sources.map((s) => ({
        id: s.id,
        label: s.label,
        checked: enabled.has(s.id),
        icon: <s.icon size={12} />,
        count: counts[s.id],
      }))}
    />
  );
}
