import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { registerEditorCloseGuard, type EditorCloseTarget } from '@core/editor';
import type { AppUpdate } from '@platform/updater';

const api = vi.hoisted(() => ({ version: vi.fn(), check: vi.fn(), prepare: vi.fn(), restart: vi.fn() }));
vi.mock('@platform/updater', () => ({ applicationVersion: api.version, checkApplicationUpdate: api.check, prepareApplicationUpdate: api.prepare, restartApplication: api.restart }));
import { useAppUpdate } from '../stores/appUpdate';

const candidate = (version = '0.2.0') => ({ version, body: 'Release notes', close: vi.fn(async () => {}), download: vi.fn<AppUpdate['download']>(async () => {}), install: vi.fn<AppUpdate['install']>(async () => {}) } satisfies AppUpdate);
let releaseGuard: (() => void) | undefined;
beforeEach(async () => {
  api.check.mockResolvedValue(null);
  useAppUpdate.setState({ phase: 'idle' });
  await useAppUpdate.getState().check();
  vi.clearAllMocks();
  api.version.mockResolvedValue('0.1.0'); api.prepare.mockResolvedValue(undefined); api.restart.mockResolvedValue(undefined);
  useAppUpdate.setState({ phase: 'idle', currentVersion: '', version: '', notes: '', downloaded: 0, total: undefined, error: '' });
});
afterEach(() => { releaseGuard?.(); releaseGuard = undefined; });

it('loads the actual application version and distinguishes current releases from check failures', async () => {
  await useAppUpdate.getState().loadVersion();
  expect(useAppUpdate.getState().currentVersion).toBe('0.1.0');
  await useAppUpdate.getState().check();
  expect(useAppUpdate.getState().phase).toBe('current');
  api.check.mockRejectedValue(new Error('Release endpoint is unavailable'));
  await useAppUpdate.getState().check();
  expect(useAppUpdate.getState()).toMatchObject({ phase: 'idle', error: 'Error: Release endpoint is unavailable' });
});

it('rejects prereleases and closes their native resources', async () => {
  const update = candidate('0.2.0-beta.1'); api.check.mockResolvedValue(update);
  await useAppUpdate.getState().check();
  expect(update.close).toHaveBeenCalledOnce();
  expect(useAppUpdate.getState().phase).toBe('idle');
  expect(useAppUpdate.getState().error).not.toBe('');
  useAppUpdate.getState().install();
  expect(update.install).not.toHaveBeenCalled();
});

it('keeps a completed download unavailable for installation until signature verification succeeds', async () => {
  const update = candidate(); api.check.mockResolvedValue(update);
  let fail!: (reason: Error) => void;
  update.download.mockImplementationOnce(async onEvent => {
    onEvent?.({ event: 'Started', data: { contentLength: 100 } });
    onEvent?.({ event: 'Progress', data: { chunkLength: 100 } });
    onEvent?.({ event: 'Finished' });
    await new Promise<void>((_resolve, reject) => { fail = reject; });
  }).mockRejectedValue(new Error('Signature verification failed'));
  await useAppUpdate.getState().check();
  const download = useAppUpdate.getState().download();
  expect(useAppUpdate.getState()).toMatchObject({ phase: 'downloading', downloaded: 100, total: 100 });
  await useAppUpdate.getState().download();
  useAppUpdate.getState().install();
  expect(update.download).toHaveBeenCalledOnce();
  expect(update.install).not.toHaveBeenCalled();
  fail(new Error('Signature verification failed')); await download;
  expect(update.download).toHaveBeenCalledTimes(3);
  expect(useAppUpdate.getState()).toMatchObject({ phase: 'available', error: 'Error: Signature verification failed' });
  expect(api.prepare).not.toHaveBeenCalled();
});

it('retries a failed download twice with a five minute timeout and resets its progress', async () => {
  const update = candidate(); api.check.mockResolvedValue(update);
  update.download.mockRejectedValueOnce(new Error('error decoding response body')).mockImplementationOnce(async onEvent => {
    onEvent?.({ event: 'Started', data: { contentLength: 100 } });
    onEvent?.({ event: 'Progress', data: { chunkLength: 100 } });
  });
  await useAppUpdate.getState().check();
  await useAppUpdate.getState().download();
  expect(update.download).toHaveBeenCalledTimes(2);
  expect(update.download).toHaveBeenNthCalledWith(1, expect.any(Function), { timeout: 300_000 });
  expect(update.download).toHaveBeenNthCalledWith(2, expect.any(Function), { timeout: 300_000 });
  expect(useAppUpdate.getState()).toMatchObject({ phase: 'ready', error: '', downloaded: 0, total: undefined });
});

it('waits for the shared unsaved-document guard before closing terminals and installing once', async () => {
  const update = candidate(); api.check.mockResolvedValue(update);
  await useAppUpdate.getState().check(); await useAppUpdate.getState().download();
  let approve!: () => void;
  const guard = vi.fn((_files: EditorCloseTarget, complete: () => void) => { approve = complete; return true; });
  releaseGuard = registerEditorCloseGuard(guard);
  useAppUpdate.getState().install();
  expect(guard).toHaveBeenCalledWith('all', expect.any(Function));
  expect(api.prepare).not.toHaveBeenCalled();
  expect(update.install).not.toHaveBeenCalled();
  approve(); approve();
  await waitFor(() => expect(api.restart).toHaveBeenCalledOnce());
  expect(update.install).toHaveBeenCalledExactlyOnceWith({ restartAfterInstall: true });
  expect(api.prepare.mock.invocationCallOrder[0]).toBeLessThan(update.install.mock.invocationCallOrder[0]);
});

it('does not apply an old approval after another update check replaces the target', async () => {
  const first = candidate(); api.check.mockResolvedValue(first);
  await useAppUpdate.getState().check(); await useAppUpdate.getState().download();
  let approve!: () => void;
  releaseGuard = registerEditorCloseGuard((_files, complete) => { approve = complete; return true; });
  useAppUpdate.getState().install();
  api.check.mockResolvedValue(candidate('0.3.0')); await useAppUpdate.getState().check();
  approve();
  expect(first.close).toHaveBeenCalledOnce();
  expect(first.install).not.toHaveBeenCalled();
  expect(api.prepare).not.toHaveBeenCalled();
});

it('retries a failed restart without installing the same package again', async () => {
  const update = candidate(); api.check.mockResolvedValue(update); api.restart.mockRejectedValueOnce(new Error('Restart failed'));
  await useAppUpdate.getState().check(); await useAppUpdate.getState().download();
  useAppUpdate.getState().install();
  await waitFor(() => expect(useAppUpdate.getState()).toMatchObject({ phase: 'installed', error: 'Error: Restart failed' }));
  useAppUpdate.getState().install();
  await waitFor(() => expect(api.restart).toHaveBeenCalledTimes(2));
  expect(update.install).toHaveBeenCalledOnce();
  expect(api.prepare).toHaveBeenCalledTimes(2);
});
