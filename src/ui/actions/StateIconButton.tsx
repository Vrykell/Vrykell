import { IconButton } from '@ui/actions/IconButton';
import { iconSizes, type AppIcon } from '@ui/icons';

export default function StateIconButton({ icon: Icon, on, title, description, onClick }: {
  icon: AppIcon; on: boolean; title: string; description?: string; onClick: () => void;
}) {
  return <IconButton type="button" className="state-icon-button" aria-pressed={on} data-tip={title} data-tip-description={description} aria-label={title} onClick={onClick}>
    <Icon size={iconSizes.control} />
  </IconButton>;
}
