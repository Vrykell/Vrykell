import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { flushDiagnostics, useDiagnosticSettings, setDiagnosticInputTrace } from '@platform/diagnostics';
import { LogsPage } from '../pages/logsPage';

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openPath: vi.fn() }));
vi.mock('../components/SettingsSaveProvider', () => ({ useSettingsSave: () => ({ save: (task: () => void) => task() }) }));
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

beforeEach(() => {
  invokeMock.mockReset().mockResolvedValue(undefined);
  useDiagnosticSettings.setState({ autoSave: false, saving: false, error: null });
  setDiagnosticInputTrace(false);
});
afterEach(async () => {
  cleanup();
  useDiagnosticSettings.setState({ autoSave: false });
  await flushDiagnostics();
  vi.restoreAllMocks();
});

it('keeps the automatic logging switch disabled until the saved state is confirmed', async () => {
  let complete!: () => void;
  invokeMock.mockImplementation(command => command === 'diagnostics_set_auto_save'
    ? new Promise<void>(resolve => { complete = resolve; }) : Promise.resolve(undefined));
  render(<LogsPage />);
  const toggle = screen.getByRole('switch', { name: '自动保存日志' });
  fireEvent.click(toggle);
  expect(toggle).toBeDisabled();
  expect(toggle).toHaveAttribute('aria-checked', 'false');
  fireEvent.click(toggle);
  await waitFor(() => expect(invokeMock.mock.calls.filter(([command]) => command === 'diagnostics_set_auto_save')).toHaveLength(1));
  await act(async () => { complete(); });
  expect(toggle).toBeEnabled();
  expect(toggle).toHaveAttribute('aria-checked', 'true');
});

it('keeps per-key tracing off until the diagnostics switch is enabled', () => {
  render(<LogsPage />);
  const toggle = screen.getByRole('switch', { name: '跟踪终端输入' });
  expect(toggle).toHaveAttribute('aria-checked', 'false');
  fireEvent.click(toggle);
  expect(useDiagnosticSettings.getState().inputTrace).toBe(true);
  expect(toggle).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(toggle);
  expect(useDiagnosticSettings.getState().inputTrace).toBe(false);
});
