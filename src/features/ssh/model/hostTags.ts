import type { HostMetadata } from '../stores/hostLibrary';
import type { SshConnection } from '../services/api';

export const TAG_COLORS = ['coral', 'blue', 'green', 'amber', 'violet', 'cyan', 'rose'] as const;
export function tagColor(tag: string): string {
  let hash = 0;
  for (const character of tag) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  return `var(--group-${TAG_COLORS[hash % TAG_COLORS.length]})`;
}
export function groupHosts(connections: SshConnection[], metadata: Record<string, HostMetadata>, by: string) {
  const groups = new Map<string, SshConnection[]>();
  for (const connection of connections) {
    const meta = metadata[connection.id];
    const names = by === 'tags' ? meta?.tags.length ? meta.tags : [''] : by === 'none' ? [''] : [meta?.group ?? ''];
    for (const name of names) groups.set(name, [...(groups.get(name) ?? []), connection]);
  }
  return [...groups].sort(([first], [second]) => !first ? 1 : !second ? -1 : first.localeCompare(second)).map(([name, hosts]) => ({ name, hosts }));
}
