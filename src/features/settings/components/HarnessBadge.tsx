/**
 * HarnessBadge — the small mark that identifies an ACP server in lists, cards and tabs.
 *
 * The agent's own icon comes first (see AGENT_MARKS): the name in the list is the agent, not the
 * model vendor behind it, so an ACP server list shows Claude Code, Codex, OpenCode and the rest
 * with their own marks. A name we do not know falls back to the vendor detection, and anything
 * unrecognised keeps a neutral tile with a generic mark — never a letter tile.
 */
import { AGENT_MARKS } from '@ui/brandMarks';
import { modelVendorInfo } from '@features/agent/components/modelIcon';

/** Lowercase letters and digits only, so 'Claude Code' and 'claudecode' resolve alike. */
const agentKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

export default function HarnessBadge({ name, size = 28 }: { name: string; size?: number }) {
  const agent = AGENT_MARKS[agentKey(name)];
  const info = modelVendorInfo('openai-compatible', name, '');
  const Mark = agent ?? info.mark;
  const branded = !agent && info.branded;
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
