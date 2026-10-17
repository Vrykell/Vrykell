import type { SshSystemStatus } from '../services/api';

export interface NetworkRateSample { time: number; download: number | null; upload: number | null }

/** Counter resets and interrupted sampling start a new baseline instead of creating spikes. */
export function networkRates(previous: { sample: SshSystemStatus; time: number } | null, sample: SshSystemStatus, time: number): NetworkRateSample {
  const elapsed = previous ? time - previous.time : 0;
  const rate = (current: number | null | undefined, before: number | null | undefined) => {
    if (elapsed <= 0 || elapsed > 45_000 || current == null || before == null || !Number.isFinite(current) || !Number.isFinite(before) || current < before) return null;
    return (current - before) / (elapsed / 1000);
  };
  return { time, download: rate(sample.networkReceived, previous?.sample.networkReceived), upload: rate(sample.networkTransmitted, previous?.sample.networkTransmitted) };
}
