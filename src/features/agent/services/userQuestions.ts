import { create } from 'zustand';
import { t } from '@i18n';

export interface UserQuestion { question: string; options?: string[] }
export interface UserAnswer { ok: boolean; answered: boolean; answer?: string; error?: string; cancelled?: boolean }
const waiting = new Map<string, (result: UserAnswer) => void>();
export const useUserQuestions = create<{ pending: Record<string, UserQuestion> }>(() => ({ pending: {} }));
export const questionKey = (conversationId: string, toolCallId: string) => JSON.stringify([conversationId, toolCallId]);

export function answerUserQuestion(key: string, answer?: string): boolean {
  if (!waiting.has(key) || answer !== undefined && (!answer.trim() || answer.length > 4000)) return false;
  waiting.get(key)!({ ok: true, answered: answer !== undefined, ...(answer !== undefined ? { answer: answer.trim() } : {}) });
  return true;
}

export function requestUserAnswer(key: string, question: UserQuestion, signal?: AbortSignal, timeoutMs = 900_000): Promise<UserAnswer> {
  if (signal?.aborted) return Promise.resolve({ ok: false, answered: false, cancelled: true, error: t('Question cancelled') });
  if (waiting.has(key)) return Promise.resolve({ ok: false, answered: false, error: t('This question is already waiting for an answer.') });
  return new Promise(resolve => {
    let closed = false;
    const finish = (result: UserAnswer) => {
      if (closed) return;
      closed = true;
      waiting.delete(key); clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      useUserQuestions.setState(state => { const pending = { ...state.pending }; delete pending[key]; return { pending }; });
      resolve(result);
    };
    const cancel = () => finish({ ok: false, answered: false, cancelled: true, error: t('Question cancelled') });
    const timer = setTimeout(() => finish({ ok: false, answered: false, error: t('No answer was received. Ask the user to continue when ready.') }), timeoutMs);
    waiting.set(key, finish);
    useUserQuestions.setState(state => ({ pending: { ...state.pending, [key]: question } }));
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
  });
}
