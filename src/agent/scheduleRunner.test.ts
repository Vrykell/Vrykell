/**
 * scheduleRunner — 定时任务调度器测试。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import type { Schedule } from '@/agent/platform';
import { initScheduleRunner, kickScheduleRunner } from '@/agent/scheduleRunner';
import { useChatStore } from '@/store/chat';

function makeSchedule(over: Partial<Schedule> = {}): Schedule {
  return {
    id: 's1',
    name: '任务',
    prompt: '提示词',
    intervalMinutes: 60,
    enabled: true,
    lastRunAt: 0,
    ...over,
  };
}

/** tick 是异步链（list → markRun → send），冲刷足够多的微任务轮次 */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function sentMessages(): unknown[] {
  return Object.values(useChatStore.getState().byTab)
    .flat()
    .filter((m) => m.role === 'user');
}

describe('scheduleRunner', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    useChatStore.setState({ byTab: {}, sendingTab: null, draft: '', contextUsed: {} });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('到期任务：先落 lastRunAt 再发送，成功一次只发一条', async () => {
    invokeMock.mockResolvedValue([makeSchedule()]);
    kickScheduleRunner();
    await flush();
    expect(invokeMock).toHaveBeenCalledWith('mark_schedule_run', {
      id: 's1',
      at: expect.any(Number),
    });
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
