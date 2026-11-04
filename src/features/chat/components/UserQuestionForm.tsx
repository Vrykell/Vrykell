import type { ReactNode } from 'react';
import { t } from '@i18n';
import { OutlineButton } from '@ui/actions/OutlineButton';
import { TextButton } from '@ui/actions/TextButton';
import { TextArea } from '@ui/fields/TextInput';

export function UserQuestionForm({ children, onSkip, onSubmit, busy = false, canSubmit }: {
  children: ReactNode; onSkip: () => void; onSubmit: () => void; busy?: boolean; canSubmit: boolean;
}) {
  return <form noValidate className="ai-tool-approval ai-user-question" aria-label={t('Answer the question')}
    onSubmit={event => { event.preventDefault(); if (!busy && canSubmit) onSubmit(); }}>
    {children}
    <div className="ai-tool-approval-actions"><TextButton disabled={busy} onClick={onSkip}>{t('Skip question')}</TextButton>
      <span className="ai-tool-approval-spacer" /><TextButton type="submit" disabled={busy || !canSubmit}>{t(busy ? 'Sending…' : 'Send answer')}</TextButton></div>
  </form>;
}

export function UserQuestionFields({ question, options, onChoose, answer, onAnswerChange, onSubmit, disabled = false, maxLength = 4000, answerLabel, selected }: {
  question?: string; options?: Array<{ value: string; label: string; description?: string }>;
  onChoose?: (value: string) => void; answer?: string; onAnswerChange?: (value: string) => void;
  onSubmit: () => void; disabled?: boolean; maxLength?: number; answerLabel?: string; selected?: string;
}) {
  return <>
    {question && <div data-selectable>{question}</div>}
    {!!options?.length && <div className="ai-question-options">{options.map(option => <OutlineButton key={option.value} disabled={disabled}
      aria-pressed={selected === option.value} onClick={() => onChoose?.(option.value)}>
      <span>{option.label}{option.description && <small>{option.description}</small>}</span>
    </OutlineButton>)}</div>}
    {onAnswerChange && <TextArea variant="field" autoSizeMaxHeight={200} style={{ minHeight: 68, maxHeight: 200 }}
      aria-label={answerLabel ?? t('Your answer')} placeholder={t('Type your answer…')} value={answer ?? ''} maxLength={maxLength} rows={2} disabled={disabled}
      onChange={event => onAnswerChange(event.target.value)} onKeyDown={event => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); onSubmit(); }
      }} />}
  </>;
}
