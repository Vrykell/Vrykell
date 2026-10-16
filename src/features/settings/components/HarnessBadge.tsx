/**
 * HarnessBadge — the small mark that identifies a harness or provider in lists, cards and tabs.
 *
 * A rounded square carrying the vendor's drawn brand mark (see brandMarks) on the brand hue when
 * the palette defines one, or a neutral tile with the mark in muted ink otherwise (a local
 * program, an aggregator with no hue, an unrecognised CLI). Never a letter tile: the mark is what
 * makes the row recognisable next to the name.
 */
import { modelVendorInfo } from '@features/agent/components/modelIcon';

export default function HarnessBadge({ name, size = 28 }: { name: string; size?: number }) {
  const info = modelVendorInfo('openai-compatible', name, '');
  const Mark = info.mark;
  return (
    <span aria-hidden="true" data-testid="harness-badge" data-hue={info.hue} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      width: size, height: size, borderRadius: Math.round(size / 3.5),
      background: info.branded ? info.hue : 'var(--hover)',
      color: info.branded ? 'var(--canvas)' : 'var(--text-secondary)',
    }}>
      <Mark size={Math.round(size * 0.62)} />
    </span>
  );
}
