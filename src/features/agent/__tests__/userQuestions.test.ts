import { afterEach, expect, it, vi } from 'vitest';
import { answerUserQuestion, questionKey, requestUserAnswer, useUserQuestions } from '../services/userQuestions';
import { buildAskUserTool } from '../tools/askUser';

afterEach(() => { vi.useRealTimers(); });

it('returns a user answer to its owning call once and removes the live request', async () => {
  const key = questionKey('owner', 'question');
  const pending = requestUserAnswer(key, { question: 'Which environment?', options: ['Preview', 'Production'] });
  expect(useUserQuestions.getState().pending[key]?.question).toBe('Which environment?');
  expect(answerUserQuestion(questionKey('other', 'question'), 'Production')).toBe(false);
  expect(answerUserQuestion(key, ' ')).toBe(false);
  expect(answerUserQuestion(key, 'Preview')).toBe(true);
  expect(await pending).toEqual({ ok: true, answered: true, answer: 'Preview' });
  expect(answerUserQuestion(key, 'Production')).toBe(false);
  expect(useUserQuestions.getState().pending[key]).toBeUndefined();
});

it('supports skipping, cancellation, timeouts and rejects duplicate requests without notifications', async () => {
  vi.useFakeTimers();
  const key = questionKey('owner', 'question');
  const skipped = requestUserAnswer(key, { question: 'Choose' });
  expect(await requestUserAnswer(key, { question: 'Duplicate' })).toMatchObject({ ok: false });
  answerUserQuestion(key);
  expect(await skipped).toEqual({ ok: true, answered: false });
  const controller = new AbortController();
  const cancelled = requestUserAnswer(key, { question: 'Choose' }, controller.signal);
  controller.abort();
  expect(await cancelled).toMatchObject({ ok: false, answered: false, cancelled: true });
  const expired = requestUserAnswer(key, { question: 'Choose' }, undefined, 20);
  await vi.advanceTimersByTimeAsync(20);
  expect(await expired).toMatchObject({ ok: false, answered: false });
  expect(useUserQuestions.getState().pending).toEqual({});
});

it('exposes a pending tool card and feeds the response back without granting permissions', async () => {
  const state = vi.fn();
  const ask = buildAskUserTool({ tabId: 'owner', setToolState: state });
  const pending = ask.execute!({ question: 'Proceed?', options: ['No', 'Yes'] }, { toolCallId: 'tool', messages: [], context: {} });
  expect(state).toHaveBeenCalledWith('tool', 'input-pending');
  answerUserQuestion(questionKey('owner', 'tool'), 'No');
  expect(await pending).toEqual({ ok: true, answered: true, answer: 'No' });
  expect(await ask.execute!({ question: 'Are you sure?' }, { toolCallId: 'repeat', messages: [], context: {} })).toMatchObject({ ok: false, answered: false });
  expect(state).toHaveBeenCalledTimes(1);
  expect(useUserQuestions.getState().pending).toEqual({});
});
