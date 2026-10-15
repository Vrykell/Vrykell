import type { AppIcon } from './icons';

/** A solid themed tile keeps small navigation symbols legible at every color. */
export default function IconTile({ icon: Icon, color, size = 20 }: { icon: AppIcon; color: string; size?: number }) {
  return <span className="icon-tile" aria-hidden="true" style={{ width: size, height: size, background: color }}>
    <Icon size={Math.round(size * 0.7)} />
  </span>;
}
