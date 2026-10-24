import { tagColor } from '../model/hostTags';

export default function HostTag({ tag }: { tag: string }) {
  return <span className="ssh-host-tag"><HostTagDot tag={tag} />{tag}</span>;
}

export function HostTagDot({ tag }: { tag: string }) { return <i className="ssh-host-tag-dot" style={{ background: tagColor(tag) }} />; }
