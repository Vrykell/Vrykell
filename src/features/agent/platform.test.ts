/**
 * platform — 记忆/子代理/定时任务 invoke 封装透传测试。
 */
import { describe, it, expect, vi } from 'vitest';
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
import {
  getMemory, setMemory, getMemoryJournal, appendMemoryJournal,
  listAgents, saveAgent, removeAgent, getAgent,
  listSchedules, saveSchedule, removeSchedule, markScheduleRun,
} from '@features/agent/services/platform';

describe('platform invoke 封装', () => {
  it('记忆命令透传', async () => {
    invokeMock.mockResolvedValueOnce('fact');
    await getMemory();
    expect(invokeMock).toHaveBeenLastCalledWith('get_memory');
    await setMemory('x');
    expect(invokeMock).toHaveBeenLastCalledWith('set_memory', { content: 'x' });
    await getMemoryJournal();
    expect(invokeMock).toHaveBeenLastCalledWith('get_memory_journal');
    await appendMemoryJournal('note');
    expect(invokeMock).toHaveBeenLastCalledWith('append_memory_journal', { text: 'note' });
  });

  it('子代理命令透传', async () => {
    invokeMock.mockResolvedValueOnce([{ id: 'a', name: 'n', description: 'd', prompt: 'p' }]);
    await listAgents();
    expect(invokeMock).toHaveBeenLastCalledWith('list_agents');
    await saveAgent({ id: '', name: 'n', description: 'd', prompt: 'p' });
    expect(invokeMock).toHaveBeenLastCalledWith('save_agent', { agent: { id: '', name: 'n', description: 'd', prompt: 'p' } });
    await removeAgent('a');
    expect(invokeMock).toHaveBeenLastCalledWith('remove_agent', { id: 'a' });
    await getAgent('n');
    expect(invokeMock).toHaveBeenLastCalledWith('get_agent', { nameOrId: 'n' });
  });

  it('定时任务命令透传', async () => {
    const s = { id: 's1', name: 't', prompt: 'p', intervalMinutes: 60, enabled: true, lastRunAt: 0 };
    invokeMock.mockResolvedValueOnce([s]);
    await listSchedules();
    expect(invokeMock).toHaveBeenLastCalledWith('list_schedules');
    await saveSchedule(s);
    expect(invokeMock).toHaveBeenLastCalledWith('save_schedule', { schedule: s });
    await removeSchedule('s1');
    expect(invokeMock).toHaveBeenLastCalledWith('remove_schedule', { id: 's1' });
    await markScheduleRun('s1', 123);
    expect(invokeMock).toHaveBeenLastCalledWith('mark_schedule_run', { id: 's1', at: 123 });
  });
});
