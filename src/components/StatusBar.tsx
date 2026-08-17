import { useTerminalStore, getFocusedTerminalId } from '../stores/terminal';
import { useAiConfigStore } from '../lib/ai';

/**
 * StatusBar — 紧凑状态栏。
 * 仅在底部显示连接状态和模型名，不做多余信息。
 */
export default function StatusBar() {
  useTerminalStore((s) => s.focusedPaneId); // 订阅聚焦切换
  const termId = getFocusedTerminalId();
  const hasSession = useTerminalStore((s) => !!s.sessions[termId]);
  const dims = useTerminalStore((s) => s.dims[termId]);
  const model = useAiConfigStore((s) => s.model);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 22,
        flexShrink: 0,
        padding: '0 12px',
        background: 'var(--surface)',
        borderTop: '1px solid var(--block-divider)',
        fontSize: 10,
        color: 'var(--text-muted)',
        userSelect: 'none',
        gap: 10,
        fontFamily: 'var(--font-mono)',
      }}
    >
      {/* 连接状态 */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: hasSession ? 'var(--shell-connected)' : 'var(--shell-disconnected)',
            display: 'inline-block',
          }}
        />
        {hasSession ? 'shell' : 'disconnected'}
      </span>

      {dims && (
        <span style={{ opacity: 0.5 }}>
          {dims.cols}×{dims.rows}
        </span>
      )}

      <div style={{ flex: 1 }} />

      <span style={{ opacity: 0.6 }}>{model}</span>
    </div>
  );
}
