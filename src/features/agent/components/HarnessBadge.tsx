/**
 * HarnessBadge — the small mark that identifies an ACP server in lists, cards and tabs.
 *
 * Configured agents use their own identity; unrecognized entries use the application mark.
 */
import { AGENT_MARKS } from '@ui/icons/brandMarks';
import type { AppIcon } from '@ui/icons';
import { modelVendorInfo } from '@features/agent/components/modelIcon';
import AppMark from '@ui/icons/AppMark';

/** Lowercase letters and digits only, so 'Claude Code' and 'claudecode' resolve alike. */
const agentKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Resolve configured agent identity without substituting a model vendor. */
export function harnessMark(name: string, fallback: AppIcon = AppMark): AppIcon {
  return AGENT_MARKS[agentKey(name)] ?? fallback;
}

export default function HarnessBadge({ name, size = 28 }: { name: string; size?: number }) {
  const info = modelVendorInfo('openai-compatible', name, '');
  const Mark = harnessMark(name);
  const branded = !AGENT_MARKS[agentKey(name)] && info.branded;
  return (
    <span aria-hidden="true" data-testid="harness-badge" data-hue={info.hue} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      width: size, height: size, borderRadius: Math.round(size / 3.5),
      background: branded ? info.hue : 'var(--hover)',
      color: branded ? 'var(--canvas)' : 'var(--text-primary)',
    }}>
      <Mark size={Math.round(size * 0.62)} />
    </span>
  );
}
