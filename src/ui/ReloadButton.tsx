import { IconButton } from './IconButton';
import { RefreshCw, iconSizes } from './icons';
import { useReloadFeedback } from './useReloadFeedback';

export default function ReloadButton({ label, onReload, busy = false, disabled = false, compact = false, testId }: {
  label: string; onReload: () => void | Promise<void>; busy?: boolean; disabled?: boolean; compact?: boolean; testId?: string;
}) {
  const reload = useReloadFeedback(onReload);
  const active = reload.busy || busy;
  return <IconButton compact={compact} data-testid={testId} aria-label={label} data-tip={label} aria-busy={active} disabled={disabled || active}
    onClick={() => { void reload.run(); }}><RefreshCw size={iconSizes.control} className={active ? 'reload-spin' : undefined} /></IconButton>;
}
