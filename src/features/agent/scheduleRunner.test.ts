/**
 * scheduleRunner — 定时任务调度器测试。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { useChatStore } from '@features/chat/stores/chat';
import { kickScheduleRunner, initScheduleRunner } from '@features/agent/services/scheduleRunner';
import type { Schedule } from '@features/agent/services/platform';

function makeSchedule(over: Partial<Schedule> = {}): Schedule {
  return { id: 's1', name: '任务', prompt: '提示词', intervalMinutes: 60, enabled: true, lastRunAt: 0, ...over };
}

/** tick 是异步链（list → markRun → send），冲刷足够多的微任务轮次 */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function sentMessages(): unknown[] {
  return Object.values(useChatStore.getState().byTab).flat().filter((m) => m.role === 'user');
}

describe('scheduleRunner', () => {
  it('coalesces overlapping polls while a schedule read is pending', async () => {
    let release!: (value: Schedule[]) => void;
    invokeMock.mockImplementation(() => new Promise<Schedule[]>(resolve => { release = resolve; }));
    kickScheduleRunner();
    kickScheduleRunner();
    kickScheduleRunner();
    expect(invokeMock).toHaveBeenCalledTimes(1);
    release([]);
    await flush();
  });
  beforeEach(() => {
    invokeMock.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    useChatStore.setState({ byTab: {}, sendingTabs: [], draft: '', contextUsed: {} });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('到期任务：先落 lastRunAt 再发送，成功一次只发一条', async () => {
    invokeMock.mockResolvedValue([makeSchedule()]);
    kickScheduleRunner();
    await flush();
    expect(invokeMock).toHaveBeenCalledWith('mark_schedule_run', { id: 's1', at: expect.any(Number) });
    const sent = sentMessages();
    expect(sent).toHaveLength(1);
    expect(String((sent[0] as { content: string }).content)).toContain('【定时任务】任务');
  });

  it('未到期任务不触发', async () => {
    invokeMock.mockResolvedValue([makeSchedule({ lastRunAt: Date.now() })]);
    kickScheduleRunner();
    await flush();
    expect(invokeMock).not.toHaveBeenCalledWith('mark_schedule_run', expect.anything());
    expect(sentMessages()).toHaveLength(0);
  });

  it('停用任务不触发', async () => {
    invokeMock.mockResolvedValue([makeSchedule({ enabled: false })]);
    kickScheduleRunner();
    await flush();
    expect(invokeMock).not.toHaveBeenCalledWith('mark_schedule_run', expect.anything());
    expect(sentMessages()).toHaveLength(0);
  });

  it('有对话正在生成时：本轮既不标记也不发送，留给下一次 tick 重试', async () => {
    // The store runs one turn at a time. Marking a run that cannot start would drop the task for a
    // whole interval, so a due task waits instead of being recorded as done.
    useChatStore.setState({ sendingTabs: ['conversation-1'] });
    invokeMock.mockResolvedValue([makeSchedule()]);
    kickScheduleRunner();
    await flush();
    expect(invokeMock).not.toHaveBeenCalledWith('mark_schedule_run', expect.anything());
    expect(sentMessages()).toHaveLength(0);
  });

  it('markScheduleRun 失败时跳过本轮，不发送（防重复触发）', async () => {
    invokeMock.mockResolvedValueOnce([makeSchedule()]);
    invokeMock.mockRejectedValueOnce(new Error('db 写入失败'));
    kickScheduleRunner();
    await flush();
    expect(invokeMock).toHaveBeenCalledWith('mark_schedule_run', expect.anything());
    expect(sentMessages()).toHaveLength(0);
  });

  it('initScheduleRunner 幂等：重复调用不重复启动，30s 后轮询', async () => {
    invokeMock.mockResolvedValue([]);
    vi.useFakeTimers();
    const un1 = initScheduleRunner();
    const un2 = initScheduleRunner();
    expect(un2()).toBeUndefined();
    await flush();
    // 初始化即立即检查一次
    expect(invokeMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(invokeMock).toHaveBeenCalledTimes(2);
    un1();
    vi.useRealTimers();
  });
});
