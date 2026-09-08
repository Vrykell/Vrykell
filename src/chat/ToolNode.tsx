/**
 * ToolNode — rail 上的动作状态节点（8px 圆，细线从圆心穿过）。
 */
import type { ToolRunState } from '@/agent/messageParts';
import { cx } from '@/shared/utils/cx';
import s from './ToolNode.module.css';

const STATE_CLASS: Record<ToolRunState, string> = {
  running: s.running,
  'approval-pending': s.approval,
  done: s.done,
  error: s.error,
  denied: s.denied,
};

export default function ToolNode({
  state,
  top = '50%',
}: {
  state: ToolRunState;
  top?: number | string;
}) {
  return <span aria-hidden className={cx(s.node, STATE_CLASS[state])} style={{ top }} />;
}
