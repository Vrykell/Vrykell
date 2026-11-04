import { useRef, useState } from 'react';
import { t } from '@i18n';
import { acpAnswerElicitation, type AcpQuestion, type AcpQuestionResponse } from '@platform/api/acp';
import { TextInput } from '@ui/fields/TextInput';
import { Checkbox } from '@ui/fields/Checkbox';
import { AskQuestion } from '@ui/icons';
import ErrorBox from '@ui/feedback/ErrorBox';
import { UserQuestionFields, UserQuestionForm } from './UserQuestionForm';
import { harnessQuestionGroups, questionLabel, questionPrompt } from '../model/harnessQuestions';
import './HarnessQuestion.css';

type Answer = string | number | boolean | string[];
export default function HarnessQuestion({ sessionId, question }: { sessionId: string; question: AcpQuestion }) {
  const [answers, setAnswers] = useState<Record<string, Answer>>(() => Object.fromEntries(question.form.fields.map(field => [field.key, field.default ?? (field.kind === 'array' ? [] : field.kind === 'boolean' ? false : '')])));
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const groups = harnessQuestionGroups(question.form.fields);
  const hasValue = (value: Answer | undefined) => typeof value === 'string' ? !!value.trim() : Array.isArray(value) ? value.length > 0 : value !== undefined;
  const canSubmit = question.form.fields.every(field => !field.required || hasValue(answers[field.key]))
    && (!question.form.fields.length || Object.values(answers).some(hasValue));
  const update = (key: string, value: Answer) => setAnswers(previous => ({ ...previous, [key]: value }));
  const respond = async (action: AcpQuestionResponse['action'], values = answers) => {
    if (sending.current || sent) return;
    sending.current = true; setBusy(true); setError(null);
    try {
      const content: Record<string, Answer> = Object.create(null) as Record<string, Answer>;
      if (action === 'accept') for (const field of question.form.fields) {
        const value = values[field.key];
        if (!hasValue(value) && !field.required) continue;
        if (field.required && !hasValue(value)) throw new Error(t('Complete the required fields before sending.'));
        if (field.kind === 'number' || field.kind === 'integer') {
          const number = Number(value);
          if (!Number.isFinite(number) || field.kind === 'integer' && !Number.isInteger(number)) throw new Error(t('Enter a valid number.'));
          content[field.key] = number;
        } else content[field.key] = value;
      }
      await acpAnswerElicitation(sessionId, question.requestId, action === 'accept' ? { action, content } : { action });
      setSent(true);
    } catch (failure) { setError(String((failure as Error)?.message ?? failure)); }
    finally { sending.current = false; setBusy(false); }
  };
  const send = () => { if (canSubmit) void respond('accept'); };
  const introduction = question.form.message.trim();
  const showIntroduction = introduction && !['question', 'questions'].includes(introduction.toLowerCase())
    && !groups.some(group => questionPrompt(question.form, group, groups.length === 1) === introduction);
  if (sent) return null;
  return <div className="chat-exchange"><div className="ai-block-answer">
    <div className="ai-tool-card" data-tool-state="input-pending" data-open={false} data-testid="harness-question">
      <button type="button" data-subtle className="ai-tool-summary" disabled aria-expanded={false} aria-label={[t('Ask the user'), t('Awaiting answer')].join(' ')}>
        <AskQuestion size={15} /><span className="ai-tool-summary-text"><span className="ai-tool-label">{t('Ask the user')}</span></span>
        <span className="ai-tool-state" data-state="input-pending">{t('Awaiting answer')}</span>
      </button>
      <UserQuestionForm onSkip={() => void respond('decline')} onSubmit={send} busy={busy} canSubmit={canSubmit}>
        {showIntroduction && <div data-selectable>{questionLabel(introduction)}</div>}
        {groups.map(group => {
          const { field, other } = group;
          const prompt = questionPrompt(question.form, group, groups.length === 1);
          const freeField = other ?? (field.kind === 'string' && !field.options.length ? field : undefined);
          const choose = (value: string) => {
            const next = { ...answers, [field.key]: value, ...(other && !other.required ? { [other.key]: '' } : {}) };
            setAnswers(next);
            if (groups.length === 1 && (!other || !field.required && !other.required)) void respond('accept', next);
          };
          return <div key={field.key} className="ai-user-question" data-question-field>
            {field.kind === 'string' ? <UserQuestionFields question={prompt} options={field.options.map(option => ({ ...option, label: questionLabel(option.label), description: questionLabel(option.description) }))}
              selected={String(answers[field.key] ?? '')} onChoose={choose} disabled={busy} onSubmit={send}
              answer={freeField ? String(answers[freeField.key] ?? '') : undefined} maxLength={freeField?.maxLength}
              answerLabel={groups.length === 1 ? t('Your answer') : prompt}
              onAnswerChange={freeField ? value => setAnswers(previous => ({ ...previous, [freeField.key]: value,
                ...(other && !field.required ? { [field.key]: '' } : {}) })) : undefined} />
              : <>
                {field.kind !== 'boolean' && <div data-selectable>{prompt}{field.required ? ' (' + t('Required') + ')' : ''}</div>}
                {field.kind === 'array' ? <div className="ai-question-options">{field.options.map(option => {
                  const selected = Array.isArray(answers[field.key]) ? answers[field.key] as string[] : [];
                  return <label className="harness-question-choice" key={option.value}><Checkbox disabled={busy} checked={selected.includes(option.value)} onChange={event => update(field.key, event.target.checked ? [...selected, option.value] : selected.filter(value => value !== option.value))} />
                    <span>{questionLabel(option.label)}{option.description && <small>{questionLabel(option.description)}</small>}</span></label>;
                })}</div> : field.kind === 'boolean' ? <label className="harness-question-choice"><Checkbox disabled={busy} checked={answers[field.key] === true} onChange={event => update(field.key, event.target.checked)} />{prompt}</label>
                  : <TextInput disabled={busy} type="number" aria-label={questionLabel(field.title || field.key)} value={String(answers[field.key] ?? '')} min={field.minimum ?? undefined} max={field.maximum ?? undefined} step={field.kind === 'integer' ? 1 : 'any'} onChange={event => update(field.key, event.target.value)} />}
                {other && <UserQuestionFields answer={String(answers[other.key] ?? '')} onAnswerChange={value => update(other.key, value)} disabled={busy} onSubmit={send} maxLength={other.maxLength} />}
              </>}
          </div>;
        })}
      </UserQuestionForm>
      {error && <ErrorBox title={t('Could not send answer')} details={error} onDismiss={() => setError(null)} />}
    </div>
  </div></div>;
}
