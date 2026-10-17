import { expect, it } from 'vitest';
import { networkRates } from '../networkRates';
import type { SshSystemStatus } from '../../services/api';

const sample: SshSystemStatus = { system: 'Linux', hostname: 'host', latencyMs: 1, uptimeSeconds: null, load: '', cpuTotal: null, cpuIdle: null, memoryTotal: null, memoryAvailable: null, diskTotal: null, diskUsed: null, networkReceived: 1000, networkTransmitted: 2000 };

it('derives download and upload bytes per second from actual elapsed sample time', () => {
  expect(networkRates({ sample, time: 1000 }, { ...sample, networkReceived: 41000, networkTransmitted: 22000 }, 5000))
    .toEqual({ time: 5000, download: 10000, upload: 5000 });
  expect(networkRates({ sample, time: 1000 }, sample, 5000).download).toBe(0);
});

it('starts a new baseline for missing counters, resets, long interruptions and invalid timing', () => {
  expect(networkRates(null, sample, 0).download).toBeNull();
  expect(networkRates({ sample, time: 0 }, sample, 0).download).toBeNull();
  expect(networkRates({ sample, time: 0 }, sample, 46000).upload).toBeNull();
  expect(networkRates({ sample, time: 0 }, { ...sample, networkReceived: 10, networkTransmitted: null }, 1000)).toEqual({ time: 1000, download: null, upload: null });
});
