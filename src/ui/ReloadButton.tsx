import { IconButton } from './IconButton';
import { RefreshCw, iconSizes } from './icons';
import { useReloadFeedback } from './useReloadFeedback';

export default function ReloadButton({ label, onReload, busy = false, disabled = false, compact = false }: {
  label: string; onReload: () => void | Promise<void>; busy?: boolean; disabled?: boolean; compact?: boolean;
}) {
  const reload = useReloadFeedback(onReload);
  const active = reload.busy || busy;
  return <IconButton compact={compact} aria-label={label} data-tip={label} aria-busy={active} disabled={disabled || active}
    onClick={() => { void reload.run(); }}><RefreshCw size={iconSizes.control} className={active ? 'reload-spin' : undefined} /></IconButton>;
}
