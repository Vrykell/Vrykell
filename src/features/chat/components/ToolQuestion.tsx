import { useState } from 'react';
import { t } from '@i18n';
import { TextArea } from '@ui/fields/TextInput';
import { TextButton } from '@ui/actions/TextButton';
import { OutlineButton } from '@ui/actions/OutlineButton';
import { answerUserQuestion, questionKey, useUserQuestions, type UserAnswer } from '@features/agent/services/userQuestions';
import type { ToolRun } from '@features/agent/model/messageParts';

export default function ToolQuestion({ run, conversationId }: { run: ToolRun; conversationId?: string }) {
  const key = questionKey(conversationId ?? '', run.toolCallId);
  const pending = useUserQuestions(state => state.pending[key]);
  const [answer, setAnswer] = useState('');
  const [submitted, setSubmitted] = useState<{ key: string; answer: string; options?: string[] } | null>(null);
  const respond = (value?: string) => {
    if (answerUserQuestion(key, value) && value !== undefined) setSubmitted({ key, answer: value.trim(), options: pending?.options });
  };
  const send = () => { if (answer.trim()) respond(answer); };
  let result: UserAnswer | undefined;
  try { result = run.output ? JSON.parse(run.output) as UserAnswer : undefined; } catch { result = undefined; }
  if (!pending) {
    if (run.state === 'error' || run.state === 'denied' || run.state === 'cancelled' || result?.ok === false) return null;
    const selected = result?.answered && typeof result.answer === 'string' ? result.answer : submitted?.key === key ? submitted.answer : undefined;
    const options = Array.isArray(run.input.options) ? run.input.options.filter((option): option is string => typeof option === 'string') : submitted?.key === key ? submitted.options : undefined;
    if (selected !== undefined && options?.includes(selected)) return <div className="ai-question-options" data-testid="tool-question-result" role="group" aria-label={t('Your answer')}>
      {[...new Set(options)].map(option => <OutlineButton key={option} disabled aria-pressed={option === selected} data-selected={option === selected}>{option}</OutlineButton>)}
    </div>;
    return <div className="ai-tool-verdict" data-testid="tool-question-result">{selected ?? t(run.state === 'input-pending' ? 'This question is no longer active. Send a message to continue.' : 'Question skipped')}</div>;
  }
  return <div className="ai-tool-approval ai-user-question" role="group" aria-label={t('Answer the question')}>
    <div data-selectable>{pending.question}</div>
    {!!pending.options?.length && <div className="ai-question-options">{pending.options.map(option => <OutlineButton key={option} aria-pressed={false} onClick={() => respond(option)}>{option}</OutlineButton>)}</div>}
    <TextArea variant="field" style={{ resize: 'vertical', minHeight: 68, maxHeight: 200 }} aria-label={t('Your answer')} placeholder={t('Type your answer…')} value={answer} maxLength={4000} rows={2}
      onChange={event => setAnswer(event.target.value)} onKeyDown={event => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); send(); }
      }} />
    <div className="ai-tool-approval-actions"><TextButton onClick={() => respond()}>{t('Skip question')}</TextButton><span className="ai-tool-approval-spacer" /><TextButton disabled={!answer.trim()} onClick={send}>{t('Send answer')}</TextButton></div>
  </div>;
}
