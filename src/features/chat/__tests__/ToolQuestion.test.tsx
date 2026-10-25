import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import ToolQuestion from '../components/ToolQuestion';
import { questionKey, requestUserAnswer, useUserQuestions } from '@features/agent/services/userQuestions';
import type { ToolRun } from '@features/agent/model/messageParts';

afterEach(cleanup);
const run: ToolRun = { toolCallId: 'question', toolName: 'ask_user', state: 'input-pending', input: {}, startedAt: 1 };

it('answers an option inside the owning transcript without a permission prompt', async () => {
  const pending = requestUserAnswer(questionKey('owner', run.toolCallId), { question: 'Which target?', options: ['Preview', 'Production'] });
  render(<ToolQuestion run={run} conversationId="owner" />);
  expect(screen.getByText('Which target?')).toBeVisible();
  expect(screen.getByRole('textbox', { name: '你的回答' })).toHaveClass('text-input-field');
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  expect(await pending).toMatchObject({ answered: true, answer: 'Preview' });
  expect(document.querySelector('#app-notifications [role="alert"]')).toBeNull();
});

it('supports custom answers and skipping without submitting empty responses', async () => {
  const key = questionKey('owner', run.toolCallId);
  const first = requestUserAnswer(key, { question: 'Which target?' });
  const view = render(<ToolQuestion run={run} conversationId="owner" />);
  expect(screen.getByRole('button', { name: '发送回答' })).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: '你的回答' }), { target: { value: 'Local preview' } });
  fireEvent.keyDown(screen.getByRole('textbox', { name: '你的回答' }), { key: 'Enter', ctrlKey: true });
  expect(await first).toMatchObject({ answer: 'Local preview' });
  view.unmount();
  const second = requestUserAnswer(key, { question: 'Which target?' });
  render(<ToolQuestion run={run} conversationId="owner" />);
  fireEvent.click(screen.getByRole('button', { name: '跳过问题' }));
  expect(await second).toEqual({ ok: true, answered: false });
});

it('does not resurrect a persisted request or expose another conversation’s live answer', async () => {
  const controller = new AbortController();
  const pending = requestUserAnswer(questionKey('other', run.toolCallId), { question: 'Private question' }, controller.signal);
  const view = render(<ToolQuestion run={run} conversationId="owner" />);
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.getByTestId('tool-question-result')).toHaveTextContent('此问题已失效');
  expect(screen.queryByText('Private question')).toBeNull();
  controller.abort(); await pending;
  view.rerender(<ToolQuestion run={{ ...run, state: 'done', output: JSON.stringify({ ok: true, answered: true, answer: 'Saved answer' }) }} conversationId="owner" />);
  expect(screen.getByText('Saved answer')).toBeVisible();
  expect(useUserQuestions.getState().pending).toEqual({});
});
