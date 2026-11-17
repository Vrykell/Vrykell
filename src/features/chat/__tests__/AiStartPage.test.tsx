/**
 * AiStartPage tests — the agent picker belongs to the AI start page, so leaving the
 * workspace must close it instead of leaving a floating dialog over the next page.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AiStartPage from '../components/AiStartPage';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@platform/diagnostics', () => ({ invoke: invokeMock, diagnostic: vi.fn() }));

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((command: string) => {
    if (command === 'acp_harnesses')
      return Promise.resolve([{ name: 'Agent', command: 'agent', args: [], env: {}, cwd: '', enabled: true }]);
    if (command === 'acp_workspace_root') return Promise.resolve('C:/work');
    if (command === 'which_cmd') return Promise.resolve(true);
    return Promise.resolve(undefined);
  });
});
afterEach(cleanup);

it('closes the agent picker when the workspace becomes inactive and does not reopen it', () => {
  const view = render(<AiStartPage open active onNewConversation={vi.fn()} onPick={vi.fn()} />);
  fireEvent.click(screen.getByTestId('ai-start-agents'));
  expect(screen.getByTestId('acp-launcher')).toBeInTheDocument();

  view.rerender(<AiStartPage open active={false} onNewConversation={vi.fn()} onPick={vi.fn()} />);
  expect(screen.queryByTestId('acp-launcher')).toBeNull();

  view.rerender(<AiStartPage open active onNewConversation={vi.fn()} onPick={vi.fn()} />);
  expect(screen.queryByTestId('acp-launcher')).toBeNull();
});
