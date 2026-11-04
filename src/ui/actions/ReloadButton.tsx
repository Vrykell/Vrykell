import { IconButton } from '@ui/actions/IconButton';
import { OutlineButton } from '@ui/actions/OutlineButton';
import { RefreshCw, iconSizes } from '@ui/icons';
import { useReloadFeedback } from '@ui/hooks/useReloadFeedback';

export default function ReloadButton({ label, onReload, busy = false, disabled = false, compact = false, testId, variant = 'icon', text, className }: {
  label: string; onReload: () => void | Promise<void>; busy?: boolean; disabled?: boolean; compact?: boolean; testId?: string;
  variant?: 'icon' | 'outline'; text?: string; className?: string;
}) {
  const reload = useReloadFeedback(onReload);
  const active = reload.busy || busy;
  const Button = variant === 'outline' ? OutlineButton : IconButton;
  return <Button {...(variant === 'icon' ? { compact } : {})} className={className} data-testid={testId} aria-label={label} data-tip={label} aria-busy={active} aria-disabled={disabled || active} disabled={disabled}
    onClick={event => { event.stopPropagation(); if (!disabled && !active) void reload.run(); }}><RefreshCw size={iconSizes.control} className={active ? 'reload-spin' : undefined} />{text}</Button>;
}
