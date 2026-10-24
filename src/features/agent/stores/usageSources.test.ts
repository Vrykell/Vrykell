import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HarnessConfig } from '@platform/api/acp';
import { useUsageSources } from './usageSources';

const { acpHarnesses } = vi.hoisted(() => ({ acpHarnesses: vi.fn<() => Promise<HarnessConfig[]>>() }));
vi.mock('@platform/api/acp', () => ({ acpHarnesses }));

const entry = (name: string, enabled = true): HarnessConfig => ({ name, enabled, command: 'agent', args: [], env: {}, cwd: '' });

beforeEach(() => {
  useUsageSources.getState().replace([]);
  acpHarnesses.mockReset();
});

describe('usage sources', () => {
  it('loads every configured source, including disabled and unused entries', async () => {
    acpHarnesses.mockResolvedValue([entry('First'), entry('Disabled', false), entry('First'), entry('')]);
    await useUsageSources.getState().refresh();
    expect(useUsageSources.getState()).toMatchObject({ configured: ['First', 'Disabled'], error: '' });
  });

  it('preserves configured sources on failure and clears the error after retry', async () => {
    useUsageSources.getState().replace(['Saved']);
    acpHarnesses.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce([entry('Recovered')]);
    await useUsageSources.getState().refresh();
    expect(useUsageSources.getState()).toMatchObject({ configured: ['Saved'], error: 'Error: Unavailable' });
    await useUsageSources.getState().refresh();
    expect(useUsageSources.getState()).toMatchObject({ configured: ['Recovered'], error: '' });
  });

  it('does not overwrite newly saved configurations with an older request', async () => {
    let resolve: (entries: HarnessConfig[]) => void = () => {};
    acpHarnesses.mockReturnValue(new Promise(result => { resolve = result; }));
    const pending = useUsageSources.getState().refresh();
    useUsageSources.getState().replace(['New', 'New']);
    resolve([entry('Old')]);
    await pending;
    expect(useUsageSources.getState()).toMatchObject({ configured: ['New'], error: '' });
  });

  it('ignores errors from an outdated request', async () => {
    let reject: (cause: Error) => void = () => {};
    acpHarnesses.mockReturnValue(new Promise((_, failure) => { reject = failure; }));
    const pending = useUsageSources.getState().refresh();
    useUsageSources.getState().replace(['New']);
    reject(new Error('Old failure'));
    await pending;
    expect(useUsageSources.getState()).toMatchObject({ configured: ['New'], error: '' });
  });
});
