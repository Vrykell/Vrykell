import CheckboxMenu from '@ui/menus/CheckboxMenu';
import { t } from '@i18n';
import type { ResultType } from '@features/search/types';
import { getSources, useEnabledSourcesStore, toggleSource } from '@features/search/services/registry';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Current match counts for each source. */
  counts: Partial<Record<ResultType, number>>;
}

/** Keep source toggles independent and leave the menu open for multiple changes. */
export default function FilterPopover({ open, onClose, counts }: Props) {
  // Subscribe before the early return to keep hook ordering stable.
  const enabled = useEnabledSourcesStore((s) => s.enabledIds);
  if (!open) return null;

  const sources = getSources();

  function handleToggle(id: ResultType) {
    const currentlyEnabled = enabled.has(id);
    toggleSource(id, !currentlyEnabled);
  }

  return (
    <CheckboxMenu
      title={t('Search scope')}
      onClose={onClose}
      onToggle={handleToggle}
      style={{ top: '100%', right: 0, marginTop: 8, width: 216 }}
      options={sources.map((s) => ({
        id: s.id,
        label: s.label,
        checked: enabled.has(s.id),
        icon: <s.icon size={16} />,
        count: counts[s.id],
      }))}
    />
  );
}
