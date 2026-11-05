import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import HarnessPermission from '../components/HarnessPermission';

afterEach(cleanup);

const permission = (options: Array<{ optionId: string; name: string }>) => ({
  toolCallId: 'call-1', generation: 1, title: 'Run the tests', options,
});

it('renders the harness options inside the shared permission card and answers the chosen one', async () => {
  const answer = vi.fn(async () => undefined);
  render(<HarnessPermission permission={permission([
    { optionId: 'allow-once', name: 'Allow once' },
    { optionId: 'reject-once', name: 'Reject' },
  ])} onAnswer={answer} />);
  const card = screen.getByTestId('harness-permission');
  expect(card).toHaveClass('ai-tool-card');
  expect(card).toHaveTextContent('Run the tests');
  expect(screen.getByTestId('harness-option-allow-once')).toBeVisible();
  // The harness already named a reject option, so the protocol cancel is not duplicated.
  expect(screen.queryByTestId('harness-option-deny')).toBeNull();
  fireEvent.click(screen.getByTestId('harness-option-allow-once'));
  await waitFor(() => expect(answer).toHaveBeenCalledWith('allow-once'));
});

it('offers the protocol cancel when the harness did not name a reject option', async () => {
  const answer = vi.fn(async () => undefined);
  render(<HarnessPermission permission={permission([{ optionId: 'allow-once', name: 'Allow once' }])} onAnswer={answer} />);
  fireEvent.click(screen.getByTestId('harness-option-deny'));
  await waitFor(() => expect(answer).toHaveBeenCalledWith(null));
});

it('ignores repeated answers while the first one is in flight', async () => {
  let release!: () => void;
  const answer = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
  render(<HarnessPermission permission={permission([
    { optionId: 'allow-once', name: 'Allow once' },
    { optionId: 'reject-once', name: 'Reject' },
  ])} onAnswer={answer} />);
  fireEvent.click(screen.getByTestId('harness-option-allow-once'));
  fireEvent.click(screen.getByTestId('harness-option-reject-once'));
  expect(answer).toHaveBeenCalledTimes(1);
  release();
  await waitFor(() => expect(answer).toHaveBeenCalledWith('allow-once'));
});
