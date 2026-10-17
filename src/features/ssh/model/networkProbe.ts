import type { NetworkProbe } from '../services/api';

export function summarizeNetworkProbe(probe: NetworkProbe) {
  const values = probe.attempts.flatMap(attempt => attempt.latencyMs != null && Number.isFinite(attempt.latencyMs) && attempt.latencyMs >= 0 ? [attempt.latencyMs] : []);
  const total = probe.attempts.length;
  return {
    total, succeeded: values.length,
    status: values.length === 0 ? 'unreachable' : values.length === total ? 'reachable' : 'partial',
    successRate: total ? Math.round(values.length / total * 100) : 0,
    average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    minimum: values.length ? Math.min(...values) : null,
    maximum: values.length ? Math.max(...values) : null,
  } as const;
}
