import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useDiagnosticSettings, setDiagnosticInputTrace } from '@platform/diagnostics';
import { LogsPage } from '../pages/logsPage';

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openPath: vi.fn() }));
vi.mock('../components/SettingsSaveProvider', () => ({ useSettingsSave: () => ({ save: (task: () => void) => task() }) }));

beforeEach(() => setDiagnosticInputTrace(false));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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
