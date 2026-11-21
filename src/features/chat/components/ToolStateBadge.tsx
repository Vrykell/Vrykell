import type { ToolRunState } from '@features/agent/model/messageParts';
import { Check, RefreshCw, X } from '@ui/icons';

export default function ToolStateBadge({ state, label, announce }: { state: ToolRunState; label: string; announce?: boolean }) {
  return (
    <span className="ai-tool-state" data-state={state} role={announce ? 'status' : undefined}>
      {state === 'done' ? (
        <Check size={12} />
      ) : state === 'running' ? (
        <RefreshCw size={12} className="reload-spin" />
      ) : state === 'error' || state === 'denied' || state === 'cancelled' ? (
        <X size={12} />
      ) : null}
      {label}
    </span>
  );
}
