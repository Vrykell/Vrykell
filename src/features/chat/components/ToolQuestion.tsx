import { useState } from 'react';
import { t } from '@i18n';
import { UserQuestionFields, UserQuestionForm } from './UserQuestionForm';
import { answerUserQuestion, questionKey, useUserQuestions, type UserAnswer } from '@features/agent/services/userQuestions';
import type { ToolRun } from '@features/agent/model/messageParts';

export default function ToolQuestion({ run, conversationId }: { run: ToolRun; conversationId?: string }) {
  const key = questionKey(conversationId ?? '', run.toolCallId);
  const pending = useUserQuestions(state => state.pending[key]);
  const [answer, setAnswer] = useState('');
  const [submitted, setSubmitted] = useState<{ key: string; answer: string } | null>(null);
  const respond = (value?: string) => {
    if (answerUserQuestion(key, value) && value !== undefined) setSubmitted({ key, answer: value.trim() });
  };
  const send = () => { if (answer.trim()) respond(answer); };
  let result: UserAnswer | undefined;
  try { result = run.output ? JSON.parse(run.output) as UserAnswer : undefined; } catch { result = undefined; }
  if (!pending) {
    if (run.state === 'error' || run.state === 'denied' || run.state === 'cancelled' || result?.ok === false) return null;
    const selected = result?.answered && typeof result.answer === 'string' ? result.answer : submitted?.key === key ? submitted.answer : undefined;
    return <div className="ai-tool-verdict ai-question-result" data-selectable data-testid="tool-question-result">{selected ?? t(run.state === 'input-pending' ? 'This question is no longer active. Send a message to continue.' : 'Question skipped')}</div>;
  }
  return <UserQuestionForm onSkip={() => respond()} onSubmit={send} canSubmit={!!answer.trim()}>
    <UserQuestionFields question={pending.question} options={pending.options?.map(option => ({ value: option, label: option }))}
      onChoose={respond} answer={answer} onAnswerChange={setAnswer} onSubmit={send} />
  </UserQuestionForm>;
}
