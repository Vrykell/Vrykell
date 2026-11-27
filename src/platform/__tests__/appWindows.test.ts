import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { create, onCreated, listen, emitTo, show, hide, destroy, focus, ignoreCursor, isVisible } = vi.hoisted(() => ({
  create: vi.fn(),
  onCreated: vi.fn(),
  listen: vi.fn(),
  emitTo: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
  destroy: vi.fn(),
  focus: vi.fn(),
  ignoreCursor: vi.fn(),
  isVisible: vi.fn(),
}));
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getAllWebviewWindows: async () => [{ label: 'app-target', setFocus: focus }],
  WebviewWindow: class {
    constructor(label: string, options: unknown) {
      create(label, options);
    }
    once = vi.fn(async (event: string, listener: () => void) => {
      if (event === 'tauri://created') onCreated(listener);
      return () => {};
    });
    show = show;
    hide = hide;
    destroy = destroy;
    setFocus = focus;
    setIgnoreCursorEvents = ignoreCursor;
    isVisible = isVisible;
  },
}));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'main' }) }));
vi.mock('@tauri-apps/api/event', () => ({ listen, emitTo }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));

afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  onCreated.mockImplementation((notify: () => void) => notify());
  listen.mockResolvedValue(() => {});
  emitTo.mockResolvedValue(undefined);
  show.mockResolvedValue(undefined);
  hide.mockResolvedValue(undefined);
  destroy.mockResolvedValue(undefined);
  focus.mockResolvedValue(undefined);
  ignoreCursor.mockResolvedValue(undefined);
  isVisible.mockResolvedValue(true);
});

it('keeps the handoff off the URL and shows the window after its contents are ready', async () => {
  const { moveToNewAppWindow } = await import('../appWindows');
  const commit = vi.fn();
  const payload = { draft: 'Unsaved draft' };
  let publish!: () => void;
  const prepared = new Promise((resolve) => {
    publish = () => resolve(payload);
  });
  const move = moveToNewAppWindow(prepared, commit, { x: 500, y: 120 });
  await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
  const [label] = create.mock.calls[0]!;
  expect(create).toHaveBeenCalledWith(
    expect.stringMatching(/^app-/),
    expect.objectContaining({
      url: `${location.pathname}?workspaceFrom=main`,
      visible: false,
      center: true,
    }),
  );
  const receive = listen.mock.calls[0]![1];
  receive({ payload: 'request' });
  await vi.waitFor(() => expect(ignoreCursor).toHaveBeenCalledWith(true));
  expect(show).not.toHaveBeenCalled();
  expect(emitTo).not.toHaveBeenCalledWith(label, `workspace-payload:${label}`, payload);
  publish();
  await vi.waitFor(() => expect(emitTo).toHaveBeenCalledWith(label, `workspace-payload:${label}`, payload));
  expect(commit).not.toHaveBeenCalled();
  receive({ payload: 'ready' });
  await move;
  expect(show).toHaveBeenCalledBefore(commit);
  expect(commit).toHaveBeenCalledOnce();
});

it('focuses the receiving window after its selection is applied', async () => {
  vi.stubGlobal('__TAURI_INTERNALS__', {});
  const { moveToExistingAppWindow } = await import('../appWindows');
  const commit = vi.fn();
  const move = moveToExistingAppWindow({ label: 'app-target' }, {}, commit);
  await vi.waitFor(() => expect(emitTo).toHaveBeenCalledWith('app-target', 'workspace-tab-offer', expect.anything()));
  const [, , { token }] = emitTo.mock.calls[0]!;
  listen.mock.calls.find(([event]) => event === `workspace-handoff:${token}`)![1]({ payload: true });
  await vi.waitFor(() => expect(emitTo).toHaveBeenCalledWith('app-target', `workspace-tab-settled:${token}`, true));
  expect(commit).toHaveBeenCalledOnce();
  expect(focus).not.toHaveBeenCalled();
  listen.mock.calls.find(([event]) => event === `workspace-tab-applied:${token}`)![1]({ payload: null });
  await move;
  expect(focus).toHaveBeenCalledOnce();
});

it('shows staged contents during the gesture and commits the same window on release', async () => {
  const { moveToNewAppWindow, showDetachedWorkspaceAt } = await import('../appWindows');
  const point = { x: 500, y: 120 };
  const contents = { draft: 'Unsaved draft' };
  showDetachedWorkspaceAt(point, undefined, Promise.resolve(contents));
  await vi.waitFor(() => expect(ignoreCursor).toHaveBeenCalledWith(true));
  expect(ignoreCursor).toHaveBeenCalledWith(true);
  const [label] = create.mock.calls[0]!;
  const receive = listen.mock.calls[0]![1];
  receive({ payload: 'request' });
  await vi.waitFor(() => expect(emitTo).toHaveBeenCalledWith(label, `workspace-payload:${label}`, contents));
  expect(show).not.toHaveBeenCalled();
  receive({ payload: 'ready' });
  await vi.waitFor(() => expect(show).toHaveBeenCalledOnce());
  const commit = vi.fn();
  const move = moveToNewAppWindow(contents, commit, point);
  await vi.waitFor(() => expect(emitTo).toHaveBeenCalledWith(label, `workspace-payload:${label}`, contents));
  await move;
  expect(create).toHaveBeenCalledOnce();
  expect(show).toHaveBeenCalledOnce();
  expect(ignoreCursor).toHaveBeenLastCalledWith(false);
  expect(commit).toHaveBeenCalledWith(label);
});

it('discards a temporary window even if the tab comes back before native creation completes', async () => {
  const { discardWarmedWorkspace, showDetachedWorkspaceAt } = await import('../appWindows');
  let notifyCreated!: () => void;
  onCreated.mockImplementation((notify) => {
    notifyCreated = notify;
  });
  showDetachedWorkspaceAt({ x: 512, y: 140 });
  await vi.waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
  discardWarmedWorkspace();
  expect(destroy).not.toHaveBeenCalled();
  notifyCreated();
  await vi.waitFor(() => expect(destroy).toHaveBeenCalledOnce());
  expect(show).not.toHaveBeenCalled();
});

it('keeps the source if a visible detached preview has disappeared by release', async () => {
  const { moveToNewAppWindow, showDetachedWorkspaceAt } = await import('../appWindows');
  const point = { x: 500, y: 120 };
  const contents = { draft: 'Unsaved draft' };
  showDetachedWorkspaceAt(point, undefined, Promise.resolve(contents));
  await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
  const receive = listen.mock.calls[0]![1];
  receive({ payload: 'request' });
  await vi.waitFor(() => expect(emitTo).toHaveBeenCalledOnce());
  receive({ payload: 'ready' });
  await vi.waitFor(() => expect(show).toHaveBeenCalledOnce());
  isVisible.mockResolvedValueOnce(false);
  const commit = vi.fn();
  await expect(moveToNewAppWindow(contents, commit, point)).rejects.toThrow();
  expect(commit).not.toHaveBeenCalled();
});

it('resumes the same detached preview after a visit to another window', async () => {
  const { concealDetachedWorkspacePreview, discardWarmedWorkspace, showDetachedWorkspaceAt } = await import('../appWindows');
  const contents = Promise.resolve({ draft: 'Unsaved draft' });
  showDetachedWorkspaceAt({ x: 500, y: 120 }, undefined, contents);
  await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
  const receive = listen.mock.calls[0]![1];
  receive({ payload: 'request' });
  await vi.waitFor(() => expect(emitTo).toHaveBeenCalledOnce());
  receive({ payload: 'ready' });
  await vi.waitFor(() => expect(show).toHaveBeenCalledOnce());
  concealDetachedWorkspacePreview();
  await vi.waitFor(() => expect(hide).toHaveBeenCalledOnce());
  showDetachedWorkspaceAt({ x: 510, y: 130 }, undefined, contents);
  await vi.waitFor(() => expect(show).toHaveBeenCalledTimes(2));
  expect(create).toHaveBeenCalledOnce();
  await discardWarmedWorkspace();
});

it('prepares the existing-window listeners while a held tab snapshot is still pending', async () => {
  vi.stubGlobal('__TAURI_INTERNALS__', {});
  const { focusWorkspaceWindow, moveToExistingAppWindow } = await import('../appWindows');
  const commit = vi.fn();
  const dragId = crypto.randomUUID();
  const contents = { draft: 'Unsaved draft' };
  let publish!: () => void;
  let drop!: (accepted: boolean) => void;
  const snapshot = new Promise((resolve) => {
    publish = () => resolve(contents);
  });
  const decision = new Promise<boolean>((resolve) => {
    drop = resolve;
  });
  const move = moveToExistingAppWindow({ label: 'app-target', dragId }, snapshot, commit, decision);
  await vi.waitFor(() => expect(listen).toHaveBeenCalledTimes(2));
  expect(emitTo).not.toHaveBeenCalled();
  publish();
  await vi.waitFor(() =>
    expect(emitTo).toHaveBeenCalledWith('app-target', 'workspace-tab-offer', expect.objectContaining({ dragId, contents })),
  );
  const [, , { token }] = emitTo.mock.calls[0]!;
  listen.mock.calls.find(([event]) => event === `workspace-handoff:${token}`)![1]({ payload: true });
  expect(commit).not.toHaveBeenCalled();
  drop(false);
  await vi.waitFor(() => expect(emitTo).toHaveBeenCalledWith('app-target', `workspace-tab-settled:${token}`, false));
  listen.mock.calls.find(([event]) => event === `workspace-tab-applied:${token}`)![1]({ payload: null });
  await expect(move).resolves.toBe(false);
  expect(commit).not.toHaveBeenCalled();
  expect(focus).not.toHaveBeenCalled();
  await focusWorkspaceWindow('app-target');
  expect(focus).toHaveBeenCalledOnce();
});

it('withdraws a brief visit before its delayed snapshot can create a preview', async () => {
  vi.stubGlobal('__TAURI_INTERNALS__', {});
  const { moveToExistingAppWindow } = await import('../appWindows');
  const commit = vi.fn();
  let publish!: () => void;
  let leave!: () => void;
  const contents = new Promise<object>((resolve) => {
    publish = () => resolve({});
  });
  const drop = new Promise<boolean>((resolve) => {
    leave = () => resolve(false);
  });
  const move = moveToExistingAppWindow({ label: 'app-target', dragId: crypto.randomUUID() }, contents, commit, drop);
  await vi.waitFor(() => expect(listen).toHaveBeenCalledTimes(2));
  leave();
  await expect(move).resolves.toBe(false);
  publish();
  expect(emitTo).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
});

it('keeps a detached window in the taskbar-free area on a scaled secondary display', async () => {
  const { detachedWindowPlacement } = await import('../appWindows');
  const display = {
    scaleFactor: 1.25,
    workArea: {
      position: { x: -1920, y: 30 },
      size: { width: 1920, height: 1000 },
    },
  };
  expect(detachedWindowPlacement({ x: -1920, y: -200 }, display)).toEqual({ x: -1920, y: 30 });
  expect(detachedWindowPlacement({ x: -1, y: 1029 }, display)).toEqual({ x: -1300, y: 130 });
});

it('leaves partly offscreen windows in place while their titlebar remains reachable', async () => {
  const { reachableTitlebar } = await import('../appWindows');
  const display = { scaleFactor: 1.25, workArea: { position: { x: 0, y: 0 }, size: { width: 1600, height: 900 } } };
  expect(reachableTitlebar({ x: -18, y: -12 }, 1040, display, 38)).toEqual({ x: -18, y: -12 });
  expect(reachableTitlebar({ x: -1040, y: -48 }, 1040, display, 38)).toEqual({ x: -780, y: -20 });
  expect(reachableTitlebar({ x: 1599, y: 899 }, 1040, display, 38)).toEqual({ x: 1340, y: 873 });
});

it('retains the grabbed position near the monitor edge and clamps an offscreen drop to the work area', async () => {
  const { grabbedTabPlacement } = await import('../appWindows');
  const display = { scaleFactor: 1.25, workArea: { position: { x: -1600, y: 40 }, size: { width: 1600, height: 860 } } };
  const anchor = { x: 80, y: 16 };
  expect(grabbedTabPlacement({ x: -20, y: 300 }, display, 1040, anchor)).toEqual({ x: -120, y: 280 });
  expect(grabbedTabPlacement({ x: -1700, y: 999 }, display, 1040, anchor)).toEqual({ x: -1700, y: 879 });
});

it('keeps the source until the held destination confirms it can still receive the drop', async () => {
  vi.stubGlobal('__TAURI_INTERNALS__', {});
  const { moveToExistingAppWindow } = await import('../appWindows');
  const commit = vi.fn();
  const move = moveToExistingAppWindow({ label: 'app-target', dragId: crypto.randomUUID() }, {}, commit, Promise.resolve(true));
  await vi.waitFor(() => expect(emitTo).toHaveBeenCalledWith('app-target', 'workspace-tab-offer', expect.anything()));
  const [, , { token }] = emitTo.mock.calls[0]!;
  const receive = listen.mock.calls.find(([event]) => event === `workspace-handoff:${token}`)![1];
  receive({ payload: true });
  await vi.waitFor(() => expect(emitTo).toHaveBeenCalledWith('app-target', `workspace-tab-settled:${token}`, 'verify'));
  expect(commit).not.toHaveBeenCalled();
  receive({ payload: 'verified' });
  await vi.waitFor(() => expect(emitTo).toHaveBeenCalledWith('app-target', `workspace-tab-settled:${token}`, true));
  listen.mock.calls.find(([event]) => event === `workspace-tab-applied:${token}`)![1]({ payload: null });
  await expect(move).resolves.toBe(true);
  expect(commit).toHaveBeenCalledOnce();
});

it('uses the live target client position even when a window moved after the geometry was read', async () => {
  const { workspaceWindowAt } = await import('../appWindows');
  const cached = [{ label: 'app-target', origin: { x: 0, y: 0 }, size: { width: 900, height: 600 }, scale: 1 }];
  expect(workspaceWindowAt({ x: 1920, y: 220, over: 'app-target', client: { x: 112, y: 14 } }, cached)).toEqual({
    label: 'app-target',
    point: { x: 112, y: 14 },
  });
  expect(workspaceWindowAt({ x: 100, y: 16, over: '' }, cached)).toBeUndefined();
  expect(workspaceWindowAt({ x: 100, y: 16 }, cached)).toEqual({ label: 'app-target', point: { x: 100, y: 16 } });
});
