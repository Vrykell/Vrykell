import { beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  subscribe: vi.fn(),
  take: vi.fn(),
  addTab: vi.fn(),
  handler: undefined as (() => void) | undefined,
}));

vi.mock('@platform/contextMenu', () => ({
  takeForwardedLaunchDirectories: mock.take,
  onForwardedLaunch: mock.subscribe,
}));
vi.mock('@features/workspace/stores/workspace', () => ({
  useWorkspaceStore: { getState: () => ({ addTab: mock.addTab }) },
}));

beforeEach(() => {
  vi.resetModules();
  mock.subscribe.mockReset().mockImplementation(async (handler: () => void) => {
    mock.handler = handler;
    return vi.fn();
  });
  mock.take.mockReset().mockResolvedValue([]);
  mock.addTab.mockReset();
});

it('opens every directory that arrived before the window could listen', async () => {
  mock.take.mockResolvedValueOnce(['C:\\early', 'C:\\also']);
  const { initForwardedLaunch } = await import('../forwardedLaunch');
  const onError = vi.fn();

  await initForwardedLaunch(onError);

  expect(mock.subscribe).toHaveBeenCalledWith(expect.any(Function));
  expect(mock.addTab.mock.calls).toEqual([[{ cwd: 'C:\\early' }], [{ cwd: 'C:\\also' }]]);
  expect(onError).not.toHaveBeenCalled();
});

it('opens a tab when the redirect event arrives and subscribes only once', async () => {
  const { initForwardedLaunch } = await import('../forwardedLaunch');
  await initForwardedLaunch(vi.fn());

  mock.take.mockResolvedValueOnce(['D:\\later']);
  mock.handler!();
  await vi.waitFor(() => expect(mock.addTab).toHaveBeenCalledWith({ cwd: 'D:\\later' }));

  await initForwardedLaunch(vi.fn());
  expect(mock.subscribe).toHaveBeenCalledOnce();
  expect(mock.addTab).toHaveBeenCalledOnce();
});

it('reports a failed subscription and retries it on the next call', async () => {
  mock.subscribe.mockRejectedValueOnce(new Error('event channel unavailable'));
  const { initForwardedLaunch } = await import('../forwardedLaunch');
  const onError = vi.fn();

  await initForwardedLaunch(onError);
  expect(onError).toHaveBeenCalledOnce();

  await initForwardedLaunch(onError);
  expect(mock.subscribe).toHaveBeenCalledTimes(2);
  expect(onError).toHaveBeenCalledOnce();
});
