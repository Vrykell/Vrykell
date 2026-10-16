/**
 * VendorDot — the vendor mark that leads a provider or model cell in the usage tables.
 *
 * A fixed drawn mark and hue per vendor so a table of rows is scannable at a glance; the hue comes
 * from the theme palette (`--brand-*`) where one exists, neutral ink otherwise.
 */
import { vendorMark } from './vendorColor';

export default function VendorDot({ provider, model }: { provider: string; model?: string }) {
  const mark = vendorMark(provider, model ?? '');
  const Mark = mark.icon;
  return (
    <span data-testid="usage-vendor-dot" data-vendor={mark.label} title={mark.label}
      aria-label={mark.label} role="img"
      style={{
        display: 'inline-flex', alignItems: 'center', flexShrink: 0, marginRight: 6,
        color: mark.color, verticalAlign: 'middle',
      }}>
      <Mark size={13} />
    </span>
  );
}
