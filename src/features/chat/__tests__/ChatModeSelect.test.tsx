import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAgentSettings, useAiConfigStore } from '@features/agent';
import ChatModeSelect from '../components/ChatModeSelect';
import ModelThinkingSettings from '@features/settings/components/ModelThinkingSettings';

describe('model-scoped conversation controls', () => {
  beforeEach(() => {
    useAiConfigStore.setState({ activeModel: 'm-one' });
    useAgentSettings.setState({ overrides: {} });
    useAgentSettings.getState().update({ agentMode: true, deepThink: false, thinkingLevel: 'high' });
  });
  it('switches only the active model mode and follows model changes', () => {
    render(<ChatModeSelect />);
    const mode = screen.getByRole('button', { name: '对话模式' });
    fireEvent.click(mode);
    expect(screen.getByRole('option', { name: /^Agent 模式/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('listbox').querySelector('svg')).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /^Chat 模式/ }));
    expect(mode).toHaveAttribute('aria-expanded', 'false');
    expect(useAgentSettings.getState().overrides['m-one']).toEqual({ agentMode: false });
    expect(useAgentSettings.getState().global.agentMode).toBe(true);
    act(() => useAiConfigStore.setState({ activeModel: 'm-two' }));
    expect(mode).toHaveTextContent('Agent 模式');
    act(() => useAiConfigStore.setState({ activeModel: 'm-one' }));
    expect(mode).toHaveTextContent('Chat 模式');
    fireEvent.click(mode);
    fireEvent.click(screen.getByRole('option', { name: /^Agent 模式/ }));
    expect(useAgentSettings.getState().overrides['m-one']).toEqual({ agentMode: true });
  });
  it('supports keyboard navigation, escape and outside dismissal', () => {
    render(<ChatModeSelect />);
    const mode = screen.getByRole('button', { name: '对话模式' });
    fireEvent.keyDown(mode, { key: 'ArrowDown' });
    const agent = screen.getByRole('option', { name: /^Agent 模式/ });
    const chat = screen.getByRole('option', { name: /^Chat 模式/ });
    expect(agent).toHaveFocus();
    fireEvent.keyDown(agent, { key: 'Home' });
    expect(chat).toHaveFocus();
    fireEvent.keyDown(chat, { key: 'End' });
    expect(agent).toHaveFocus();
    fireEvent.keyDown(agent, { key: 'ArrowUp' });
    expect(chat).toHaveFocus();
    fireEvent.keyDown(chat, { key: 'Escape' });
    expect(mode).toHaveFocus();
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(mode);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(useAgentSettings.getState().resolve('m-one').agentMode).toBe(true);
  });
  it('configures reasoning on its model without changing the conversation mode', () => {
    render(<ModelThinkingSettings modelId="m-one" name="模型一" />);
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.change(screen.getByRole('combobox', { name: '模型一的思考强度' }), { target: { value: 'low' } });
    expect(useAgentSettings.getState().overrides['m-one']).toEqual({ deepThink: true, thinkingLevel: 'low' });
    expect(useAgentSettings.getState().global.deepThink).toBe(false);
    expect(useAgentSettings.getState().resolve('m-one').agentMode).toBe(true);
  });
});
