import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPerformanceProbe } from '../diagnosticPerformance';

describe('performance diagnostics', () => {
  let now = 0;
  let frame: FrameRequestCallback;
  let stop: (() => void) | undefined;
  const record = vi.fn();
  const reportFrame = vi.fn();

  beforeEach(() => {
    now = 0;
    record.mockClear(); reportFrame.mockClear();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frame = callback; return 1; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    vi.stubGlobal('PerformanceObserver', undefined);
  });
  afterEach(() => { stop?.(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('shows that timers progressed while frames were paused without flooding the log', () => {
    stop = startPerformanceProbe(record, reportFrame, 250);
    for (now = 1000; now <= 3000; now += 1000) vi.advanceTimersByTime(1000);
    now = 3000; frame(now);
    expect(reportFrame).toHaveBeenLastCalledWith(3000, { timerTicksDuringGap: 3, timerAgeMs: 0, timerLagMs: 0 });
    expect(record.mock.calls.map(call => call[0])).toEqual(['performance-probe-capabilities']);
  });

  it('records event-loop delay independently of which callback resumes first', () => {
    stop = startPerformanceProbe(record, reportFrame, 250);
    now = 70_000;
    frame(now);
    expect(reportFrame).toHaveBeenLastCalledWith(70_000, { timerTicksDuringGap: 0, timerAgeMs: 70_000, timerLagMs: 0 });
    vi.advanceTimersByTime(1000);
    expect(record).toHaveBeenCalledWith('event-loop-delay', expect.objectContaining({ lagMs: 69_000 }));
  });

  it('records slow task and script attribution without URL queries or external locations', () => {
    const callbacks = new Map<string, PerformanceObserverCallback>();
    const disconnect = vi.fn();
    vi.stubGlobal('PerformanceObserver', class {
      static supportedEntryTypes = ['longtask', 'long-animation-frame'];
      constructor(private callback: PerformanceObserverCallback) {}
      observe({ type }: PerformanceObserverInit) { callbacks.set(type!, this.callback); }
      disconnect = disconnect;
    });
    stop = startPerformanceProbe(record, reportFrame, 250);
    const deliver = (type: string, entries: object[]) => callbacks.get(type)!(
      { getEntries: () => entries } as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    );
    deliver('longtask', [{ startTime: 100, duration: 100 }, { startTime: 200, duration: 500 }]);
    deliver('long-animation-frame', [{ startTime: 200, duration: 600, blockingDuration: 550, scripts: [
      { duration: 500, sourceURL: `${location.origin}/src/layout.ts?token=private-query#private-fragment`, sourceFunctionName: 'updateLayout' },
      { duration: 60, sourceURL: 'https://private-host.example/private-script.js?secret=private-value' },
    ] }]);
    expect(record.mock.calls.filter(call => call[0] === 'main-thread-long-task')).toHaveLength(1);
    expect(record).toHaveBeenCalledWith('main-thread-long-frame', expect.objectContaining({
      durationMs: 600, blockingDurationMs: 550,
      scripts: [expect.objectContaining({ sourcePath: '/src/layout.ts', functionName: 'updateLayout' }), expect.objectContaining({ sourcePath: undefined })],
    }));
    expect(JSON.stringify(record.mock.calls)).not.toMatch(/private-/);
    stop();
    expect(disconnect).toHaveBeenCalledTimes(2);
    record.mockClear();
    deliver('longtask', [{ startTime: 700, duration: 500 }]);
    vi.advanceTimersByTime(1000);
    expect(record).not.toHaveBeenCalled();
  });

  it('keeps the timer and frame probes working when observation is rejected', () => {
    vi.stubGlobal('PerformanceObserver', class {
      static supportedEntryTypes = ['longtask'];
      observe() { throw new Error('unsupported'); }
    });
    stop = startPerformanceProbe(record, reportFrame, 250);
    expect(record).toHaveBeenCalledWith('performance-probe-capabilities', { entryTypes: [], timerIntervalMs: 1000 });
    now = 1000; vi.advanceTimersByTime(1000); frame(now);
    expect(reportFrame).toHaveBeenCalledWith(1000, expect.objectContaining({ timerTicksDuringGap: 1 }));
  });
});
