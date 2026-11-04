import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useAgentSettings } from '@features/agent';
import ModelContextSettings from '../components/ModelContextSettings';
import { SettingsSaveProvider } from '../components/SettingsSaveProvider';
const initial = useAgentSettings.getState();
afterEach(() => { cleanup(); useAgentSettings.setState(initial, true); });
it('retains existing defaults and keeps context limits independent for each model', async () => {
  useAgentSettings.setState({ global: { ...initial.global, contextMaxTokens: 1000000 }, overrides: { second: { contextMaxTokens: 128000 } } });
  const view = render(<SettingsSaveProvider><ModelContextSettings modelId="first" /></SettingsSaveProvider>);
  const budget = screen.getAllByRole('spinbutton')[0];
  expect(budget).toHaveValue(1000000);
  fireEvent.change(budget, { target: { value: '200000' } }); fireEvent.blur(budget);
  await waitFor(() => expect(useAgentSettings.getState().resolve('first').contextMaxTokens).toBe(200000));
  expect(useAgentSettings.getState().global.contextMaxTokens).toBe(1000000);
  expect(useAgentSettings.getState().resolve('second').contextMaxTokens).toBe(128000);
  view.rerender(<SettingsSaveProvider><ModelContextSettings key="second" modelId="second" /></SettingsSaveProvider>);
  expect(screen.getAllByRole('spinbutton')[0]).toHaveValue(128000);
});
it('edits the default configuration without creating a model override and hides toggle state text', async () => {
  useAgentSettings.setState({ global: { ...initial.global, contextMaxTokens: 1000000, temperature: 0.7 }, overrides: {} });
  render(<SettingsSaveProvider><ModelContextSettings global /></SettingsSaveProvider>);
  expect(screen.queryByText('已开启')).toBeNull();
  const budget = screen.getAllByRole('spinbutton')[0];
  fireEvent.change(budget, { target: { value: '200000' } });
  fireEvent.blur(budget);
  await waitFor(() => expect(useAgentSettings.getState().global.contextMaxTokens).toBe(200000));
  expect(useAgentSettings.getState().overrides).toEqual({});
});
it('resetting behavior fields preserves independent context and thinking limits', () => {
  useAgentSettings.setState({ overrides: { first: { agentMode: false, contextMaxTokens: 128000, deepThink: true } } });
  useAgentSettings.getState().resetModelFields('first', ['agentMode', 'systemPrompt', 'maxSteps']);
  expect(useAgentSettings.getState().overrides.first).toEqual({ contextMaxTokens: 128000, deepThink: true });
});
