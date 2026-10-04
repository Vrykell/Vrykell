import type { LucideIcon } from 'lucide-react';

export default function StateIconButton({ icon: Icon, on, title, onClick }: {
  icon: LucideIcon; on: boolean; title: string; onClick: () => void;
}) {
  return <button type="button" className="state-icon-button" aria-pressed={on} title={title} onClick={onClick}>
    <Icon size={14} />
  </button>;
}
