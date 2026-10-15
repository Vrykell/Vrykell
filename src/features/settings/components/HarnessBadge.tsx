/**
 * HarnessBadge — the small mark that identifies a harness in lists, cards and tabs.
 *
 * A rounded square tinted with the vendor hue the palette already defines (the usage page's dots use
 * the same tokens), carrying the harness's initial. Deliberately not a third-party logo: the app
 * ships no brand assets, so the mark is ours and stays recognisable next to the name.
 */
import { iconSizes } from '@ui/icons';

/** Hue per harness family, mirroring the vendor tokens the rest of the app uses. */
function hueFor(name: string): string {
  if (/claude|anthropic/i.test(name)) return 'var(--brand-anthropic)';
  if (/codex|openai/i.test(name)) return 'var(--brand-openai)';
  if (/gemini|google/i.test(name)) return 'var(--brand-gemini)';
  if (/deepseek/i.test(name)) return 'var(--brand-deepseek)';
  return 'var(--accent)';
}

export default function HarnessBadge({ name, size = 28 }: { name: string; size?: number }) {
  const initial = (name.trim().match(/[A-Za-z0-9\u4e00-\u9fa5]/)?.[0] ?? '?').toUpperCase();
  return (
    <span aria-hidden="true" data-testid="harness-badge" data-hue={hueFor(name)} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      width: size, height: size, borderRadius: Math.round(size / 3.5),
      background: hueFor(name), color: 'var(--canvas)',
      fontSize: Math.max(iconSizes.compact, Math.round(size / 2.2)), fontWeight: 'var(--fw-semibold)',
      lineHeight: 1, userSelect: 'none',
    }}>
      {initial}
    </span>
  );
}
