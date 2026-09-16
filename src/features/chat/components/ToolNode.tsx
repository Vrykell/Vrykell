/**
 * ToolNode — rail 上的动作状态节点（8px 圆，细线从圆心穿过）。
 *
 *   running          暖色描边环 + pulse（复用 theme.css @keyframes pulse）
 *   approval-pending 静态暖色描边环
 *   done             绿实心
 *   error            红实心
 *   denied           灰描边环
 *
 * 环态中心透明——rail 细线视觉上穿过节点；实心态的填充自然盖住线。
 * 定位约定：包含块是 AiBlock 的行容器（position:relative; paddingLeft:16，
 * 其左缘即 rail x 坐标）；本组件 left:0 + translateX(-50%) 压线。
 * top 默认 '50%'（单行行高居中），ToolRunCard/错误行传首行中心偏移 12。
 */

import type { CSSProperties } from 'react';
import type { ToolRunState } from '@features/agent/model/messageParts';

const STATE_STYLE: Record<ToolRunState, CSSProperties> = {
  running: { border: '1.5px solid var(--accent-warm)', animation: 'pulse 1s infinite' },
  'approval-pending': { border: '1.5px solid var(--accent-warm)' },
  done: { background: 'var(--success)', border: '1.5px solid var(--success)' },
  error: { background: 'var(--error)', border: '1.5px solid var(--error)' },
  denied: { border: '1.5px solid var(--text-muted)' },
};

export default function ToolNode({
  state,
  top = '50%',
}: {
  state: ToolRunState;
  top?: number | string;
}) {
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        left: 0,
        top,
        width: 8,
        height: 8,
        borderRadius: '50%',
        transform: 'translate(-50%, -50%)',
        background: 'transparent',
        boxSizing: 'border-box',
        flexShrink: 0,
        ...STATE_STYLE[state],
      }}
    />
  );
}
