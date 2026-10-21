import { afterEach, expect, it, vi } from 'vitest';
const invoke = vi.hoisted(() => vi.fn(async () => ({ decision: 'allow', lease: 'lease' })));
vi.mock('@platform/diagnostics', () => ({ invoke }));
import { authorizeToolCall, approveToolCall, clearToolSessionGrants } from '../services/toolPolicy';
import { setProviderKey, useAiConfigStore } from '../stores/aiConfig';

afterEach(() => invoke.mockReset().mockResolvedValue({ decision: 'allow', lease: 'lease' }));

it('carries conversation identity through policy decisions, approval and revocation', async () => {
  await authorizeToolCall({ tool: 'run_command', args: { command: 'build' }, conversationId: 'conversation-a' });
  expect(invoke).toHaveBeenLastCalledWith('authorize_tool_call', { request: {
    tool: 'run_command', args: { command: 'build' }, conversationId: 'conversation-a', shell: null, mode: 'standard',
  } });
  await approveToolCall('run_command', undefined, { command: 'build' }, 'session', 'conversation-a');
  expect(invoke).toHaveBeenLastCalledWith('approve_tool_call', expect.objectContaining({ conversationId: 'conversation-a' }));
  await clearToolSessionGrants('conversation-a');
  expect(invoke).toHaveBeenLastCalledWith('tool_policy_clear_session_grants', { conversationId: 'conversation-a' });
});

it('reports a failed credential write without marking its endpoint configured', async () => {
  useAiConfigStore.setState({ providerKeys: ['existing'] });
  invoke.mockRejectedValueOnce(new Error('provider-key-write-failed'));
  await expect(setProviderKey('new-endpoint', 'new-key')).rejects.toThrow('无法保存 API 密钥');
  expect(useAiConfigStore.getState().providerKeys).toEqual(['existing']);
});
