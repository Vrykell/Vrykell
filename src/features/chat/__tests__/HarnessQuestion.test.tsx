import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import HarnessQuestion from '../components/HarnessQuestion';
import { acpAnswerElicitation, type AcpQuestion } from '@platform/api/acp';
vi.mock('@platform/api/acp', () => ({ acpAnswerElicitation: vi.fn(async () => undefined) }));
const question: AcpQuestion = { requestId: 'request-one', form: { message: 'Choose the changes', fields: [
  { key: 'scope', title: 'Scope', kind: 'array', required: true, options: [{ value: 'all', label: 'All changes', description: 'Navigation and caching' }, { value: 'cache', label: 'Cache only', description: '' }], default: ['all'], description: '', minimum: null, maximum: null, minLength: 0, maxLength: 4000, minItems: 1, maxItems: 64 },
  { key: 'count', title: 'Count', kind: 'integer', required: true, options: [], default: 3, description: '', minimum: 1, maximum: 10, minLength: 0, maxLength: 4000, minItems: 0, maxItems: 0 },
] } };
afterEach(() => { cleanup(); vi.mocked(acpAnswerElicitation).mockReset(); });
it('lets the user review multiple choices and sends typed answers to their owner', async () => {
  render(<HarnessQuestion sessionId="connection-one" question={question} />);
  expect(screen.getByRole('button', { name: '询问用户 等待回答' })).toBeDisabled();
  expect(screen.getByText('等待回答')).toBeVisible();
  fireEvent.click(screen.getByLabelText('Cache only'));
  expect(acpAnswerElicitation).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Count'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: '发送回答' }));
  await waitFor(() => expect(acpAnswerElicitation).toHaveBeenCalledWith('connection-one', 'request-one', { action: 'accept', content: { scope: ['all', 'cache'], count: 5 } }));
  await waitFor(() => expect(screen.queryByTestId('harness-question')).toBeNull());
});
it('keeps the draft after a failed answer so the user can retry', async () => {
  vi.mocked(acpAnswerElicitation).mockRejectedValueOnce(new Error('Connection unavailable'));
  render(<HarnessQuestion sessionId="connection-one" question={question} />);
  fireEvent.click(screen.getByRole('button', { name: '发送回答' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('无法发送回答'));
  expect(screen.getByLabelText('Count')).toHaveValue(3);
  fireEvent.click(screen.getByRole('button', { name: '发送回答' }));
  await waitFor(() => expect(acpAnswerElicitation).toHaveBeenCalledTimes(2));
});
it('skips the question without transmitting form answers', async () => {
  render(<HarnessQuestion sessionId="connection-one" question={question} />);
  fireEvent.click(screen.getByRole('button', { name: '跳过问题' }));
  await waitFor(() => expect(acpAnswerElicitation).toHaveBeenCalledWith('connection-one', 'request-one', { action: 'decline' }));
});

const choice = { ...question.form.fields[0], key: 'target', title: 'Next step', description: 'How should we continue?', kind: 'string' as const, required: false, default: '' };
const other = { ...choice, key: 'target_other', title: 'Next step (other)', description: 'Type your own answer', options: [] };
const paired: AcpQuestion = { requestId: 'paired', form: { message: 'Questions', fields: [choice, other] } };

it('renders a generated companion as one native question with a localized custom answer', async () => {
  render(<HarnessQuestion sessionId="owner" question={paired} />);
  expect(screen.getAllByText('How should we continue?')).toHaveLength(1);
  expect(screen.queryByText(/Questions|Next step|Type your own answer|\(other\)/)).toBeNull();
  expect(screen.getByPlaceholderText('输入你的回答…')).toBeVisible();
  expect(screen.getAllByRole('textbox')).toHaveLength(1);
  expect(screen.getByRole('button', { name: '发送回答' })).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: '你的回答' }), { target: { value: 'Use the local terminal' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', ctrlKey: true, isComposing: true });
  expect(acpAnswerElicitation).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', ctrlKey: true });
  await waitFor(() => expect(acpAnswerElicitation).toHaveBeenCalledWith('owner', 'paired', { action: 'accept', content: { target_other: 'Use the local terminal' } }));
});

it('submits a single choice immediately using the original schema value', async () => {
  render(<HarnessQuestion sessionId="owner" question={paired} />);
  fireEvent.click(screen.getByRole('button', { name: 'Cache only' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cache only' }));
  await waitFor(() => expect(acpAnswerElicitation).toHaveBeenCalledExactlyOnceWith('owner', 'paired', { action: 'accept', content: { target: 'cache' } }));
});

it('preserves required enum constraints instead of inventing an alternate answer', () => {
  render(<HarnessQuestion sessionId="owner" question={{ ...paired, form: { ...paired.form, fields: [{ ...choice, required: true }, other] } }} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Custom' } });
  expect(screen.getByRole('button', { name: '发送回答' })).toBeDisabled();
  expect(acpAnswerElicitation).not.toHaveBeenCalled();
});
