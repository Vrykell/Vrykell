/**
 * scheduleRunner — 定时任务调度器（应用级，App.tsx 挂载一次）。
 *
 * 之前调度轮询写在设置页组件里，用户不开设置页时任务永远不会触发；
 * 提升到这里后，应用运行期间每 30s 检查一次所有启用的定时任务。
 */
import { listSchedules, markScheduleRun } from '@/features/agent/services/platform';
import { sendToChat } from '@/store/chat';

const POLL_MS = 30_000;

let timer: ReturnType<typeof setInterval> | null = null;

/** 检查并触发到期任务；markScheduleRun 成功后才发送，失败跳过本轮防重复触发。 */
async function tick(): Promise<void> {
  const list = await listSchedules().catch((e) => {
    console.warn('[scheduleRunner] 读取定时任务失败:', e);
    return [];
  });
  const now = Date.now();
  for (const s of list) {
    if (!s.enabled) continue;
    if (s.lastRunAt && now - s.lastRunAt < s.intervalMinutes * 60_000) continue;
    try {
      await markScheduleRun(s.id, now);
      sendToChat(`【定时任务】${s.name}\n${s.prompt}`);
    } catch (e) {
      console.warn('[scheduleRunner] 定时任务触发失败（跳过本轮，防止重复发送）:', s.id, e);
    }
  }
}

/** 启动调度器（幂等）；返回解绑函数。 */
export function initScheduleRunner(): () => void {
  if (timer !== null) return () => {};
  void tick();
  timer = setInterval(() => void tick(), POLL_MS);
  return () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** 立即检查一次（设置页保存/删除后调用，让改动马上生效）。 */
export function kickScheduleRunner(): void {
  void tick();
}
