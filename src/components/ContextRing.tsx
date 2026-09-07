/**
 * ContextRing — 上下文占用圆环（估算 token / 预算）。压缩完成时数值变小，圆环自动减少。
 */
import { useContextUsage } from '@/stores/chat';

export default function ContextRing() {
  const { used, budget } = useContextUsage();
  if (used == null || budget == null || budget <= 0) return null;
  const pct = Math.min(1, used / budget);
  const r = 6;
  const c = 2 * Math.PI * r;
  const color = pct > 0.9 ? 'var(--accent-warm)' : 'var(--accent)';
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      style={{ flexShrink: 0, cursor: 'default', display: 'block' }}
    >
      <title>{`上下文 ${Math.round(pct * 100)}%（${Math.round(used / 1000)}k / ${Math.round(budget / 1000)}k token）`}</title>
      <circle cx="9" cy="9" r={r} fill="none" stroke="var(--border)" strokeWidth="2.5" />
      <circle
        cx="9"
        cy="9"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        strokeLinecap="round"
        transform="rotate(-90 9 9)"
      />
    </svg>
  );
}
