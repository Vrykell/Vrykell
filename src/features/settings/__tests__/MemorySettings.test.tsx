import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemorySettings } from '../pages/MemorySettings';

const storage = vi.hoisted(() => ({ memoryStats: vi.fn() }));
vi.mock('@features/agent/services/platform', () => storage);
afterEach(() => { cleanup(); storage.memoryStats.mockReset(); });

it('shows bounded aggregate status without loading or displaying memory content', async () => {
  storage.memoryStats.mockResolvedValue({ total: 100_000, active: 60_000, pending: 10_000, expired: 20_000, inactive: 10_000 });
  render(<MemorySettings />);
  await waitFor(() => expect(screen.getByTestId('memory-count-total')).toHaveTextContent('100000'));
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(storage.memoryStats).toHaveBeenCalledTimes(1);
});
it('keeps read failures in the shared error surface with retry', async () => {
  storage.memoryStats.mockRejectedValue(new Error('Storage unavailable'));
  render(<MemorySettings />);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('无法读取记忆状态'));
  expect(screen.getByRole('button', { name: '重试' })).toBeVisible();
});
