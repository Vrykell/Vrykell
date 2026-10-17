import { expect, it } from 'vitest';
import { summarizeNetworkProbe } from '../networkProbe';

it('summarizes connectivity and successful connect times separately from failures', () => {
  expect(summarizeNetworkProbe({ dnsMs: 1, attempts: [
    { latencyMs: 20, errorKind: null }, { latencyMs: null, errorKind: 'timeout' }, { latencyMs: 40, errorKind: null },
  ] })).toEqual({ total: 3, succeeded: 2, status: 'partial', successRate: 67, average: 30, minimum: 20, maximum: 40 });
  expect(summarizeNetworkProbe({ dnsMs: 0, attempts: [{ latencyMs: 0, errorKind: null }] }).status).toBe('reachable');
});

it('does not invent latency for failed or invalid readings', () => {
  const summary = summarizeNetworkProbe({ dnsMs: 0, attempts: [{ latencyMs: NaN, errorKind: null }, { latencyMs: -1, errorKind: null }, { latencyMs: null, errorKind: 'refused' }] });
  expect(summary.status).toBe('unreachable');
  expect(summary.average).toBeNull();
  expect(summary.minimum).toBeNull();
  expect(summarizeNetworkProbe({ dnsMs: 0, attempts: [] }).successRate).toBe(0);
});
