/**
 * VendorDot — the small brand-coloured mark that leads a provider or model cell.
 *
 * Mirrors the reference dashboard's coloured app column: a fixed hue per vendor so a table of
 * rows is scannable at a glance. The hue comes from the theme palette (`--brand-*`).
 */
import { vendorMark } from './vendorColor';

export default function VendorDot({ provider, model }: { provider: string; model?: string }) {
  const mark = vendorMark(provider, model ?? '');
  return (
    <span data-testid="usage-vendor-dot" data-vendor={mark.label} title={mark.label}
      aria-label={mark.label} role="img"
      style={{
        display: 'inline-block', width: 7, height: 7, marginRight: 6, borderRadius: '50%',
        background: mark.color, flexShrink: 0, verticalAlign: 'middle',
      }} />
  );
}
