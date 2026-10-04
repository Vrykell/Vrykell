import { iconSizes, type AppIcon } from '@ui/icons';

export default function StateIconButton({ icon: Icon, on, title, onClick }: {
  icon: AppIcon; on: boolean; title: string; onClick: () => void;
}) {
  return <button type="button" className="state-icon-button" aria-pressed={on} title={title} onClick={onClick}>
    <Icon size={iconSizes.control} />
  </button>;
}
