import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAgentSettings, useAiConfigStore, usePermissions } from '@features/agent';
import ChatModeSelect from '../components/ChatModeSelect';
import ModelThinkingSettings from '@features/settings/components/ModelThinkingSettings';

describe('model-scoped conversation controls', () => {
  beforeEach(() => {
    useAiConfigStore.setState({ activeModel: 'm-one' });
    usePermissions.setState({ mode: 'standard' });
    useAgentSettings.setState({ overrides: {} });
    useAgentSettings.getState().update({ agentMode: true, deepThink: false, thinkingLevel: 'high' });
  });
  it('switches only the active model mode and follows model changes', () => {
    render(<ChatModeSelect />);
    const mode = screen.getByRole('button', { name: '对话与审批模式' });
    fireEvent.click(mode);
    expect(screen.getByRole('option', { name: /^标准权限/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('option')).toHaveLength(4);
    fireEvent.click(screen.getByRole('option', { name: /^纯聊天/ }));
    expect(mode).toHaveAttribute('aria-expanded', 'false');
    expect(useAgentSettings.getState().overrides['m-one']).toEqual({ agentMode: false });
    expect(useAgentSettings.getState().global.agentMode).toBe(true);
    act(() => useAiConfigStore.setState({ activeModel: 'm-two' }));
    expect(mode).toHaveTextContent('标准');
    act(() => useAiConfigStore.setState({ activeModel: 'm-one' }));
    expect(mode).toHaveTextContent('聊天');
    fireEvent.click(mode);
    fireEvent.click(screen.getByRole('option', { name: /^标准权限/ }));
    expect(useAgentSettings.getState().overrides['m-one']).toEqual({ agentMode: true });
  });
  it('selects each approval level explicitly and enables tools', () => {
    render(<ChatModeSelect />);
    const trigger = screen.getByRole('button', { name: '对话与审批模式' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: /^纯聊天/ }));
    for (const [label, permission] of [['严格权限', 'strict'], ['放行模式', 'relaxed'], ['标准权限', 'standard']] as const) {
      fireEvent.click(trigger);
      fireEvent.click(screen.getByRole('option', { name: new RegExp(`^${label}`) }));
      expect(usePermissions.getState().mode).toBe(permission);
      expect(useAgentSettings.getState().resolve('m-one').agentMode).toBe(true);
    }
  });
  it('supports all four keyboard options, escape and outside dismissal', () => {
    render(<ChatModeSelect />);
    const trigger = screen.getByRole('button', { name: '对话与审批模式' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const standard = screen.getByRole('option', { name: /^标准权限/ });
    const chat = screen.getByRole('option', { name: /^纯聊天/ });
    const relaxed = screen.getByRole('option', { name: /^放行模式/ });
    expect(standard).toHaveFocus();
    fireEvent.keyDown(standard, { key: 'Home' }); expect(chat).toHaveFocus();
    fireEvent.keyDown(chat, { key: 'ArrowUp' }); expect(relaxed).toHaveFocus();
    fireEvent.keyDown(relaxed, { key: 'ArrowDown' }); expect(chat).toHaveFocus();
    fireEvent.keyDown(chat, { key: 'Escape' }); expect(trigger).toHaveFocus();
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(trigger); fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(usePermissions.getState().mode).toBe('standard');
  });
  it('keeps a single active highlight so hovering overrides the selected row', () => {
    render(<ChatModeSelect />);
    fireEvent.click(screen.getByRole('button', { name: '对话与审批模式' }));
    const standard = screen.getByRole('option', { name: /^标准权限/ });
    const relaxed = screen.getByRole('option', { name: /^放行模式/ });
    const active = () => screen.getAllByRole('option').filter(option => option.getAttribute('data-active') === 'true');
    expect(standard).toHaveAttribute('data-active', 'true');
    expect(active()).toHaveLength(1);
    fireEvent.pointerMove(relaxed);
    expect(relaxed).toHaveAttribute('data-active', 'true');
    expect(standard).not.toHaveAttribute('data-active', 'true');
    expect(active()).toHaveLength(1);
  });
  it('configures reasoning on its model without changing the conversation mode', () => {
    render(<ModelThinkingSettings modelId="m-one" name="模型一" />);
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('combobox', { name: '模型一的思考强度' }));
    fireEvent.click(screen.getByRole('option', { name: '低' }));
    expect(useAgentSettings.getState().overrides['m-one']).toEqual({ deepThink: true, thinkingLevel: 'low' });
    expect(useAgentSettings.getState().global.deepThink).toBe(false);
    expect(useAgentSettings.getState().resolve('m-one').agentMode).toBe(true);
  });
});
