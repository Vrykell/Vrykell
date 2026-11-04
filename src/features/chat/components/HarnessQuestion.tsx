import { useRef, useState } from 'react';
import { t } from '@i18n';
import { acpAnswerElicitation, type AcpQuestion, type AcpQuestionResponse } from '@platform/api/acp';
import { TextInput, TextArea } from '@ui/fields/TextInput';
import { Checkbox } from '@ui/fields/Checkbox';
import { OutlineButton } from '@ui/actions/OutlineButton';
import { TextButton } from '@ui/actions/TextButton';
import { AskQuestion } from '@ui/icons';
import ErrorBox from '@ui/feedback/ErrorBox';
import './HarnessQuestion.css';

type Answer = string | number | boolean | string[];
export default function HarnessQuestion({ sessionId, harness, question }: { sessionId: string; harness: string; question: AcpQuestion }) {
  const [answers, setAnswers] = useState<Record<string, Answer>>(() => Object.fromEntries(question.form.fields.map(field => [field.key, field.default ?? (field.kind === 'array' ? [] : field.kind === 'boolean' ? false : '')])));
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const update = (key: string, value: Answer) => setAnswers(previous => ({ ...previous, [key]: value }));
  const respond = async (action: AcpQuestionResponse['action']) => {
    if (sending.current || sent) return;
    sending.current = true; setBusy(true); setError(null);
    try {
      const content: Record<string, Answer> = Object.create(null) as Record<string, Answer>;
      if (action === 'accept') for (const field of question.form.fields) {
        const value = answers[field.key];
        if (value === '' && !field.required) continue;
        if (field.required && (value === '' || Array.isArray(value) && value.length === 0)) throw new Error(t('Complete the required fields before sending.'));
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
  if (sent) return null;
  return <div className="chat-exchange">
    <div className="ai-block-answer">
      <div className="ai-tool-card" data-tool-state="input-pending" data-open={false} data-testid="harness-question">
        <button type="button" data-subtle className="ai-tool-summary" disabled aria-expanded={false}
          aria-label={`${t('Ask the user')} ${t('{{name}} is asking', { name: harness })} ${t('Awaiting answer')}`}>
          <AskQuestion size={15} /><span className="ai-tool-summary-text">
            <span className="ai-tool-label">{t('Ask the user')}</span><span className="ai-tool-description">{t('{{name}} is asking', { name: harness })}</span>
          </span>
          <span className="ai-tool-state" data-state="input-pending">{t('Awaiting answer')}</span>
        </button>
        <form noValidate className="ai-tool-approval ai-user-question harness-question" aria-label={t('Answer the question')}
          onSubmit={event => { event.preventDefault(); void respond('accept'); }}>
          <div data-selectable>{question.form.message}</div>
          {question.form.fields.map(field => <fieldset key={field.key} disabled={busy} className="harness-question-field">
            <legend>{field.title || field.key}{field.required ? ` (${t('Required')})` : ''}</legend>
            {field.description && <p>{field.description}</p>}
            {field.kind === 'array' ? <div className="ai-question-options">{field.options.map(option => {
              const selected = Array.isArray(answers[field.key]) ? answers[field.key] as string[] : [];
              return <label className="harness-question-choice" key={option.value}><Checkbox checked={selected.includes(option.value)} onChange={event => update(field.key, event.target.checked ? [...selected, option.value] : selected.filter(value => value !== option.value))} />
                <span>{option.label}{option.description && <small>{option.description}</small>}</span></label>;
            })}</div> : field.kind === 'boolean' ? <label className="harness-question-choice"><Checkbox checked={answers[field.key] === true} onChange={event => update(field.key, event.target.checked)} />{field.title || field.key}</label>
              : field.options.length > 0 ? <div className="ai-question-options">{field.options.map(option => <OutlineButton key={option.value} aria-pressed={answers[field.key] === option.value} onClick={() => update(field.key, option.value)}>
                <span>{option.label}{option.description && <small>{option.description}</small>}</span></OutlineButton>)}</div>
              : field.kind === 'string' ? <TextArea variant="field" aria-label={field.title || field.key} value={String(answers[field.key] ?? '')} maxLength={field.maxLength} rows={2} autoSizeMaxHeight={200} onChange={event => update(field.key, event.target.value)} />
              : <TextInput type="number" aria-label={field.title || field.key} value={String(answers[field.key] ?? '')} min={field.minimum ?? undefined} max={field.maximum ?? undefined} step={field.kind === 'integer' ? 1 : 'any'} onChange={event => update(field.key, event.target.value)} />}
          </fieldset>)}
          <div className="ai-tool-approval-actions"><TextButton disabled={busy} onClick={() => void respond('decline')}>{t('Decline')}</TextButton><TextButton disabled={busy} onClick={() => void respond('cancel')}>{t('Cancel')}</TextButton><span className="ai-tool-approval-spacer" /><TextButton type="submit" disabled={busy}>{t(busy ? 'Sending…' : 'Send answer')}</TextButton></div>
          {error && <ErrorBox title={t('Could not send answer')} details={error} onDismiss={() => setError(null)} />}
        </form>
      </div>
    </div>
  </div>;
}
