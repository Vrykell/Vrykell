import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TerminalRedrawButton } from '../components/TerminalRedrawButton';
import { redrawTerminal } from '../services/terminalRepaint';

vi.mock('../services/terminalRepaint', () => ({ redrawTerminal: vi.fn() }));

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('redraws its own pane once and shows a full rotation before allowing another click', async () => {
  render(<TerminalRedrawButton paneId="running-pane" />);
  const button = screen.getByRole('button', { name: '重绘终端' });
  expect(button).toHaveAttribute('data-tip-shortcut');
  await act(async () => { fireEvent.click(button); fireEvent.click(button); });
  expect(redrawTerminal).toHaveBeenCalledExactlyOnceWith('running-pane');
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute('aria-busy', 'true');
  expect(button.querySelector('svg')).toHaveClass('reload-spin');
  act(() => vi.advanceTimersByTime(799));
  expect(button).toBeDisabled();
  act(() => vi.advanceTimersByTime(1));
  expect(button).toBeEnabled();
  expect(button).toHaveAttribute('aria-busy', 'false');
  expect(button.querySelector('svg')).not.toHaveClass('reload-spin');
  await act(async () => { fireEvent.click(button); });
  expect(redrawTerminal).toHaveBeenCalledTimes(2);
});
