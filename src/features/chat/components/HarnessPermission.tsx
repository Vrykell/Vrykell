import { useState } from 'react';
import { t } from '@i18n';
import { ShieldAlert } from '@ui/icons';
import { OutlineButton } from '@ui/actions/OutlineButton';
import { TextButton } from '@ui/actions/TextButton';
import type { HarnessSession } from '../stores/harness';

type Permission = NonNullable<HarnessSession['permission']>;

/**
 * A permission request in the transcript, shaped like the question and tool cards next to it.
 * The agent's own option names stay untouched; the protocol cancel is offered as a separate
 * reject action only when the agent did not already provide one.
 */
export default function HarnessPermission({ permission, onAnswer }: {
  permission: Permission;
  onAnswer: (optionId: string | null) => Promise<unknown> | unknown;
}) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const answer = async (optionId: string | null) => {
    if (busy || sent) return;
    setBusy(true);
    try {
      await onAnswer(optionId);
      setSent(true);
    } finally {
      setBusy(false);
    }
  };
  if (sent) return null;
  const hasReject = permission.options.some(option => /reject|deny|cancel|拒绝/i.test(`${option.optionId} ${option.name}`));
  return <div className="chat-exchange"><div className="ai-block-answer">
    <div className="ai-tool-card" data-tool-state="approval-pending" data-testid="harness-permission">
      <div className="ai-tool-summary" role="status">
        <ShieldAlert size={15} aria-hidden="true" />
        <span className="ai-tool-summary-text"><span className="ai-tool-label">{t('Permission required')}</span></span>
        <span className="ai-tool-state" data-state="approval-pending">{t('Awaiting decision')}</span>
      </div>
      <div className="ai-tool-approval">
        <div data-selectable>{t('The harness is waiting for your decision:')} {permission.title}</div>
        <div className="ai-question-options">
          {permission.options.map(option => <OutlineButton key={option.optionId} data-testid={`harness-option-${option.optionId}`}
            disabled={busy} onClick={() => void answer(option.optionId)}>{option.name}</OutlineButton>)}
        </div>
        {!hasReject && <div className="ai-tool-approval-actions">
          <span className="ai-tool-approval-spacer" />
          <TextButton data-testid="harness-option-deny" disabled={busy} onClick={() => void answer(null)}>{t('Deny')}</TextButton>
        </div>}
      </div>
    </div>
  </div></div>;
}
