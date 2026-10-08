import { t } from '@i18n';
import { IconButton, type ControlTone } from '@ui/IconButton';
import { ShieldAlert, ShieldCheck, ShieldOff, iconSizes, type AppIcon } from '@ui/icons';

type PermissionMode = 'standard' | 'strict' | 'relaxed';
const modes: Array<{ id: PermissionMode; label: string; description: string; icon: AppIcon; tone: ControlTone }> = [
  { id: 'standard', label: 'Standard permissions', description: 'Use the configured tool rules.', icon: ShieldCheck, tone: 'neutral' },
  { id: 'strict', label: 'Strict permissions', description: 'Ask before every tool action.', icon: ShieldAlert, tone: 'warning' },
  { id: 'relaxed', label: 'Relaxed permissions', description: 'Allow tools. Ask before dangerous commands.', icon: ShieldOff, tone: 'danger' },
];

/** One permission control keeps both composers visually and behaviorally consistent. */
export default function PermissionModeButton({ mode, onChange }: { mode: PermissionMode; onChange: (mode: PermissionMode) => void }) {
  const index = Math.max(0, modes.findIndex(item => item.id === mode));
  const current = modes[index];
  const Icon = current.icon;
  return <IconButton data-subtle data-testid="permission-mode-button" data-mode={current.id}
    tone={current.tone} aria-label={t(current.label)} data-tip={t(current.label)}
    data-tip-description={t(current.description)} onClick={() => onChange(modes[(index + 1) % modes.length].id)}>
    <Icon size={iconSizes.control} />
  </IconButton>;
}
