import { describe, expect, it } from 'vitest';
import { sensitiveActionReason } from '@features/agent/model/sensitiveActions';

describe('sensitiveActionReason', () => {
  it('flags durable writes and leaves the read paths alone', () => {
    expect(sensitiveActionReason('memory', { action: 'update', content: 'x' })).toContain('长期记忆');
    expect(sensitiveActionReason('memory', { action: 'append', text: 'x' })).toContain('长期记忆');
    expect(sensitiveActionReason('memory', { action: 'read' })).toBeNull();
    expect(sensitiveActionReason('memory', { action: 'search', query: 'x' })).toBeNull();

    expect(sensitiveActionReason('subagent', { action: 'create', name: 'a' })).toContain('子代理');
    expect(sensitiveActionReason('subagent', { action: 'remove', agent: 'a' })).toContain('子代理');
    expect(sensitiveActionReason('subagent', { action: 'list' })).toBeNull();
    expect(sensitiveActionReason('subagent', { action: 'spawn', agent: 'a', task: 't' })).toBeNull();

    expect(sensitiveActionReason('schedule', { action: 'create', name: 'n' })).toContain('循环任务');
    expect(sensitiveActionReason('schedule', { action: 'toggle', name: 'n' })).toContain('循环任务');
    expect(sensitiveActionReason('schedule', { action: 'remove', name: 'n' })).toContain('循环任务');
    expect(sensitiveActionReason('schedule', { action: 'list' })).toBeNull();
  });

  it('ignores tools without durable actions and unknown actions', () => {
    expect(sensitiveActionReason('run_command', { command: 'ls' })).toBeNull();
    expect(sensitiveActionReason('read_file', { path: '/tmp/a' })).toBeNull();
    expect(sensitiveActionReason('memory', {})).toBeNull();
    expect(sensitiveActionReason('memory', { action: 'not-an-action' })).toBeNull();
  });
});
