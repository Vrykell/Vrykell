type RecordDiagnostic = (event: string, detail: unknown) => void;

interface ScriptTiming {
  duration: number;
  sourceURL?: string;
  sourceFunctionName?: string;
  sourceCharPosition?: number;
  invokerType?: string;
  forcedStyleAndLayoutDuration?: number;
}

interface SlowFrameTiming extends PerformanceEntry {
  blockingDuration?: number;
  scripts?: ScriptTiming[];
}

export interface FrameSchedulingDetail {
  timerTicksDuringGap: number;
  timerAgeMs: number;
  timerLagMs: number;
}

function sourcePath(source: string | undefined): string | undefined {
  if (!source) return undefined;
  try {
    const url = new URL(source, location.href);
    return url.origin === location.origin ? url.pathname : undefined;
  } catch {
    return undefined;
  }
}

/** Compare frame and timer progress; a frame gap alone cannot identify its cause. */
export function startPerformanceProbe(
  record: RecordDiagnostic,
  reportFrame: (gapMs: number, detail: FrameSchedulingDetail) => void,
  stallMs: number,
): () => void {
  let lastFrameAt = performance.now();
  let lastTimerAt = lastFrameAt;
  let timerTicks = 0;
  let timerLag = 0;
  let stopped = false;
  const observers: PerformanceObserver[] = [];
  const supported: string[] = [];

  for (const type of ['longtask', 'long-animation-frame']) {
    try {
      if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes.includes(type)) continue;
      const observer = new PerformanceObserver(list => {
        if (stopped) return;
        for (const entry of list.getEntries().filter(entry => entry.duration >= stallMs).slice(-10)) {
          const frame = entry as SlowFrameTiming;
          record(type === 'longtask' ? 'main-thread-long-task' : 'main-thread-long-frame', {
            startTimestampMs: Math.round(performance.timeOrigin + entry.startTime),
            durationMs: Math.round(entry.duration),
            blockingDurationMs: frame.blockingDuration,
            visibility: document.visibilityState,
            hasFocus: document.hasFocus(),
            scripts: frame.scripts?.slice().sort((a, b) => b.duration - a.duration).slice(0, 5).map(script => ({
              durationMs: Math.round(script.duration),
              sourcePath: sourcePath(script.sourceURL),
              functionName: script.sourceFunctionName?.slice(0, 120),
              sourceCharPosition: script.sourceCharPosition,
              invokerType: script.invokerType,
              forcedStyleAndLayoutDurationMs: script.forcedStyleAndLayoutDuration,
            })),
          });
        }
      });
      observer.observe({ type });
      observers.push(observer);
      supported.push(type);
    } catch {
      // Unsupported observation must not affect startup on embedded surfaces.
    }
  }
  record('performance-probe-capabilities', { entryTypes: supported, timerIntervalMs: 1000 });

  const timer = window.setInterval(() => {
    const now = performance.now();
    const lagMs = Math.max(0, now - lastTimerAt - 1000);
    timerTicks += 1;
    timerLag = Math.max(timerLag, lagMs);
    lastTimerAt = now;
    if (lagMs >= stallMs) record('event-loop-delay', {
      lagMs: Math.round(lagMs),
      frameAgeMs: Math.round(now - lastFrameAt),
      visibility: document.visibilityState,
      hasFocus: document.hasFocus(),
    });
  }, 1000);

  const watchFrame = () => {
    if (stopped) return;
    const now = performance.now();
    reportFrame(now - lastFrameAt, {
      timerTicksDuringGap: timerTicks,
      timerAgeMs: Math.round(now - lastTimerAt),
      timerLagMs: Math.round(timerLag),
    });
    lastFrameAt = now;
    timerTicks = 0;
    timerLag = 0;
    frame = window.requestAnimationFrame(watchFrame);
  };
  let frame = window.requestAnimationFrame(watchFrame);
  return () => {
    stopped = true;
    window.clearInterval(timer);
    window.cancelAnimationFrame(frame);
    observers.forEach(observer => observer.disconnect());
  };
}
