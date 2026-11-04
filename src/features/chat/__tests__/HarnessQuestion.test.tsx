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
  render(<HarnessQuestion sessionId="connection-one" harness="Example agent" question={question} />);
  expect(screen.getByText('Example agent 正在提问')).toBeVisible();
  expect(screen.getByRole('button', { name: /Example agent 正在提问 等待回答/ })).toBeDisabled();
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
  render(<HarnessQuestion sessionId="connection-one" harness="Example agent" question={question} />);
  fireEvent.click(screen.getByRole('button', { name: '发送回答' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('无法发送回答'));
  expect(screen.getByLabelText('Count')).toHaveValue(3);
  fireEvent.click(screen.getByRole('button', { name: '发送回答' }));
  await waitFor(() => expect(acpAnswerElicitation).toHaveBeenCalledTimes(2));
});
it.each(['拒绝回答', '取消'])('supports %s without transmitting form answers', async label => {
  render(<HarnessQuestion sessionId="connection-one" harness="Example agent" question={question} />);
  fireEvent.click(screen.getByRole('button', { name: label }));
  await waitFor(() => expect(acpAnswerElicitation).toHaveBeenCalledWith('connection-one', 'request-one', { action: label === '取消' ? 'cancel' : 'decline' }));
});
