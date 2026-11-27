import { getAllWebviewWindows, WebviewWindow } from '@tauri-apps/api/webviewWindow';
import {
  availableMonitors,
  cursorPosition,
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
  monitorFromPoint,
  PhysicalPosition,
  type Monitor,
} from '@tauri-apps/api/window';
import { Channel, isTauri } from '@tauri-apps/api/core';
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { t } from '@i18n';
import { isMacOS } from './runtime';
import { diagnostic, invoke } from './diagnostics';
import {
  isWorkspaceWindowLabel as validWorkspaceLabel,
  secondaryWorkspaceLabel,
  useWorkspaceWindowStaging,
  workspaceSessionPrefix,
} from './workspaceWindowIdentity';

export interface DesktopPoint {
  x: number;
  y: number;
}
interface DragPoint extends DesktopPoint {
  over?: string;
  client?: DesktopPoint;
  dock?: number;
}
export interface TabDragGrip {
  ratio: number;
  offsetY: number;
}
interface TabBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface WorkspaceWindowTarget {
  label: string;
  point?: DesktopPoint;
  dragId?: string;
  grabRatio?: number;
}
export interface IncomingTabMove {
  ready?: Promise<void>;
  present?: () => void;
  tabBounds?: () => TabBounds | undefined;
  finish: (accepted: boolean) => void;
}
export const canOpenWorkspaceWindow = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window && isTauri();

const WORKSPACE_SOURCE_PARAM = 'workspaceFrom';
const HANDOFF_TIMEOUT_MS = 20_000;
const DETACHED_WINDOW_WAIT_MS = 40_000;

export function detachedWorkspaceRoute() {
  const source = new URLSearchParams(window.location.search).get(WORKSPACE_SOURCE_PARAM);
  if (!source || !validWorkspaceLabel(source)) return null;
  const label = secondaryWorkspaceLabel();
  return label && label !== source ? { label, source } : null;
}

export async function otherWorkspaceSessionPrefixes(): Promise<string[]> {
  if (!isTauri()) return [];
  const current = getCurrentWindow().label;
  const windows = await getAllWebviewWindows().catch(() => []);
  return windows
    .filter((window) => window.label !== current && window.label.startsWith('app-'))
    .map((window) => workspaceSessionPrefix(window.label));
}

async function otherWorkspaceWindows() {
  if (!canOpenWorkspaceWindow()) return [];
  const current = getCurrentWindow().label;
  return (await getAllWebviewWindows()).filter((window) => window.label !== current && validWorkspaceLabel(window.label));
}

interface WorkspaceWindowGeometry {
  label: string;
  origin: DesktopPoint;
  size: { width: number; height: number };
  scale: number;
}

async function workspaceWindowGeometry(): Promise<(WorkspaceWindowGeometry | undefined)[]> {
  return Promise.all(
    (await otherWorkspaceWindows()).map(async (window) => {
      try {
        const [visible, minimized, origin, size, scale] = await Promise.all([
          window.isVisible(),
          window.isMinimized(),
          window.innerPosition(),
          window.innerSize(),
          window.scaleFactor(),
        ]);
        return visible && !minimized && scale > 0 ? { label: window.label, origin, size, scale } : undefined;
      } catch {
        return undefined;
      }
    }),
  );
}

export function workspaceWindowAt(
  point: DragPoint,
  peers: readonly (WorkspaceWindowGeometry | undefined)[],
): WorkspaceWindowTarget | undefined {
  if (point.over && validWorkspaceLabel(point.over) && point.client && Number.isFinite(point.client.x) && Number.isFinite(point.client.y)) {
    return { label: point.over, point: point.client };
  }
  for (const peer of peers) {
    if (!peer || (point.over !== undefined && point.over !== peer.label)) continue;
    const x = (point.x - peer.origin.x) / peer.scale;
    const y = (point.y - peer.origin.y) / peer.scale;
    if (x >= 0 && x < peer.size.width / peer.scale && y >= -4 && y < (isMacOS ? 42 : 38)) {
      return { label: peer.label, point: { x, y: Math.max(0, y) } };
    }
  }
}

export async function clientPointToDesktop(point: DesktopPoint): Promise<DesktopPoint> {
  return (await workspacePointMapper())(point);
}

export async function workspacePointMapper(): Promise<(point: DesktopPoint) => DesktopPoint> {
  const current = getCurrentWindow();
  const [position, scale] = await Promise.all([current.innerPosition(), current.scaleFactor()]);
  return (point) => ({ x: position.x + point.x * scale, y: position.y + point.y * scale });
}

const dragPointerEvent = 'workspace-tab-pointer';

export async function listenForWorkspaceDragPointer(update: (point: DesktopPoint | null, dragId: string) => void) {
  if (!canOpenWorkspaceWindow()) return () => {};
  const target = getCurrentWindow().label;
  let active: string | undefined;
  let expires: ReturnType<typeof setTimeout> | undefined;
  const end = (dragId: string) => {
    if (active !== dragId) return;
    clearTimeout(expires);
    active = undefined;
    update(null, dragId);
  };
  const stop = await listen<{ point?: DesktopPoint; dragId: string }>(
    dragPointerEvent,
    ({ payload }) => {
      const { point, dragId } = payload ?? {};
      if (typeof dragId !== 'string' || !validToken(dragId)) return;
      if (!point) return end(dragId);
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      if (active && active !== dragId) end(active);
      active = dragId;
      clearTimeout(expires);
      update(point, dragId);
      expires = setTimeout(() => end(dragId), 30_000);
    },
    { target },
  );
  return () => {
    stop();
    if (active) end(active);
  };
}

export function trackWorkspaceDrag(
  moveWindow: boolean,
  dockable: boolean,
  grabRatio?: number,
  onAttach?: (target: WorkspaceWindowTarget | undefined) => void,
  onFreeMove?: (point: DesktopPoint, outside: boolean, sourceClient?: DesktopPoint, sourceStrip?: boolean) => void,
) {
  const excludedWindow = warmLabel;
  const loadPeers = () =>
    workspaceWindowGeometry()
      .then((peers) => peers.filter((peer) => peer?.label !== excludedWindow))
      .catch(() => []);
  const windowAt = (point: DragPoint, windows: readonly (WorkspaceWindowGeometry | undefined)[]) => {
    const hit = workspaceWindowAt(point, windows);
    return hit?.label === excludedWindow || hit?.label === warmLabel ? undefined : hit;
  };
  let peers: ReturnType<typeof loadPeers> | undefined;
  const geometryAt = (point: DragPoint) => (point.over === undefined || point.over ? (peers ??= loadPeers()) : Promise.resolve([]));
  const source = getCurrentWindow();
  const sourceBounds =
    !moveWindow && dockable
      ? Promise.all([source.innerPosition(), source.innerSize(), source.scaleFactor()]).catch(() => null)
      : Promise.resolve(null);
  const isOutside = (point: DesktopPoint, bounds: Awaited<typeof sourceBounds>) =>
    !!bounds &&
    (point.x < bounds[0].x ||
      point.y < bounds[0].y ||
      point.x >= bounds[0].x + bounds[1].width ||
      point.y >= bounds[0].y + bounds[1].height);
  const mayHitPeer = (point: DragPoint, outside: boolean) => moveWindow || point.over !== undefined || outside;
  const clientInSource = (point: DragPoint, bounds: Awaited<typeof sourceBounds>) => {
    if (point.over === source.label) return point.client;
    if (bounds && !isOutside(point, bounds)) return { x: (point.x - bounds[0].x) / bounds[2], y: (point.y - bounds[0].y) / bounds[2] };
  };
  const sourceStripAt = (point: DragPoint, client?: DesktopPoint) =>
    client && (point.over === source.label || (point.over === undefined && client.y < (isMacOS ? 42 : 38))) ? client : undefined;
  let attached: WorkspaceWindowTarget | undefined;
  let lastPoint: DesktopPoint | undefined;
  let observedNative = false;
  let nativeTracking = true;
  let ended = false;
  let latest: DragPoint | undefined;
  let queued = false;

  const publish = (target: WorkspaceWindowTarget) => {
    const point = target.point;
    if (!point || (point.x === lastPoint?.x && point.y === lastPoint.y)) return;
    lastPoint = point;
    void emitTo(target.label, dragPointerEvent, { point, dragId: attached?.dragId }).catch(() => {});
  };
  const clearTarget = () => {
    if (attached) void emitTo(attached.label, dragPointerEvent, { dragId: attached.dragId }).catch(() => {});
    attached = undefined;
    lastPoint = undefined;
  };
  const hit = (target: WorkspaceWindowTarget) => {
    if (!onAttach || !nativeTracking) return;
    if (attached?.label !== target.label) {
      clearTarget();
      attached = { ...target, dragId: crypto.randomUUID(), grabRatio };
      onAttach(attached);
    }
    publish(target);
  };
  const free = (point: DragPoint, outside: boolean, client?: DesktopPoint, sourceStrip = false) => {
    if (attached) {
      clearTarget();
      onAttach?.(undefined);
    }
    onFreeMove?.(point, outside, client, sourceStrip);
  };
  const end = () => {
    ended = true;
    clearTarget();
  };
  const update = (point: DragPoint) => {
    latest = point;
    if (ended || !dockable) return;
    const direct = windowAt(point, []);
    if (direct) {
      if (direct.label !== source.label) hit(direct);
      else free(point, false, direct.point, true);
      return;
    }
    if (queued) return;
    queued = true;
    void sourceBounds.then(async (bounds) => {
      const geometry = latest && mayHitPeer(latest, isOutside(latest, bounds)) ? await geometryAt(latest) : [];
      queued = false;
      if (ended || !latest) return;
      const outside = isOutside(latest, bounds);
      const target = mayHitPeer(latest, outside) ? windowAt(latest, geometry) : undefined;
      if (target) hit(target);
      else {
        const client = clientInSource(latest, bounds);
        free(latest, outside, client, !!sourceStripAt(latest, client));
      }
    });
  };
  const updates = new Channel<DragPoint>();
  updates.onmessage = (point) => {
    observedNative = true;
    update(point);
  };
  const nativeRelease = invoke<DragPoint | [number, number] | null>('drag_workspace_window', {
    moveWindow,
    updates,
    dockable,
    excludedWindow,
  })
    .then((point) => (Array.isArray(point) ? { x: point[0], y: point[1] } : point))
    .finally(() => {
      nativeTracking = false;
    });
  const dropAt = async (point: DragPoint | null) => {
    if (!point || !dockable) return {};
    const direct = windowAt(point, []);
    if (direct) return direct.label === source.label ? { sourcePoint: direct.point } : { target: { ...direct, grabRatio } };
    const [geometry, bounds] = await Promise.all([geometryAt(point), sourceBounds]);
    const outside = isOutside(point, bounds);
    let target = mayHitPeer(point, outside) ? windowAt(point, geometry) : undefined;
    if (!target && point.over) target = windowAt(point, await loadPeers());
    return {
      target: target && { ...target, grabRatio },
      outside,
      sourcePoint: !target ? sourceStripAt(point, clientInSource(point, bounds)) : undefined,
    };
  };
  return {
    nativeRelease,
    update: (point: DesktopPoint) => {
      if (!observedNative) update(point);
    },
    observedNative: () => observedNative,
    dropAt,
    finish: (point: DragPoint | null, target?: WorkspaceWindowTarget) => {
      const last = target ?? (point && windowAt(point, []));
      if (last && attached?.label === last.label) publish(last);
      diagnostic('workspace-window-drop', {
        moveWindow,
        hasPoint: !!point,
        matchingWindow: !!point?.over,
        targetFound: !!last || !!attached,
      });
      end();
    },
    restore: (point: DragPoint | null) =>
      point?.dock === undefined ? Promise.resolve() : invoke<void>('restore_workspace_dock', { dock: point.dock }).catch(() => {}),
    cancel: end,
  };
}

interface DisplayWorkArea {
  scaleFactor: number;
  workArea: { position: DesktopPoint; size: { width: number; height: number } };
}

/** Position a detached surface in physical coordinates so mixed-scale monitor origins stay intact. */
export function detachedWindowPlacement(
  point: DesktopPoint,
  monitor: DisplayWorkArea,
  size = { width: 1040, height: 720 },
  anchor = { x: 64, y: 22 },
) {
  const { position, size: area } = monitor.workArea;
  const scale = monitor.scaleFactor;
  const keepVisible = (value: number, start: number, available: number, windowSize: number) =>
    Math.round(Math.max(start, Math.min(value, start + Math.max(0, available - windowSize * scale))));
  return {
    x: keepVisible(point.x - Math.max(0, Math.min(size.width, anchor.x)) * scale, position.x, area.width, size.width),
    y: keepVisible(point.y - Math.max(0, Math.min(size.height, anchor.y)) * scale, position.y, area.height, size.height),
  };
}

export function grabbedTabPlacement(point: DesktopPoint, monitor: DisplayWorkArea, width: number, anchor: DesktopPoint) {
  const scale = monitor.scaleFactor;
  const { position, size } = monitor.workArea;
  const at = {
    x: Math.max(position.x, Math.min(point.x, position.x + size.width - 1)),
    y: Math.max(position.y, Math.min(point.y, position.y + size.height - 1)),
  };
  return {
    x: Math.round(at.x - Math.max(0, Math.min(width - 1, anchor.x)) * scale),
    y: Math.round(at.y - anchor.y * scale),
  };
}

/** Preserve the placed window while a usable stretch of its titlebar remains on screen. */
export function reachableTitlebar(origin: DesktopPoint, width: number, monitor: DisplayWorkArea, titlebarHeight: number) {
  const { position, size } = monitor.workArea;
  const scale = monitor.scaleFactor;
  const horizontalGrip = Math.min(208 * scale, width, size.width);
  const verticalGrip = 22 * scale;
  return {
    x: Math.round(Math.max(position.x - width + horizontalGrip, Math.min(origin.x, position.x + size.width - horizontalGrip))),
    y: Math.round(
      Math.max(position.y - titlebarHeight * scale + verticalGrip, Math.min(origin.y, position.y + size.height - verticalGrip)),
    ),
  };
}

async function workspaceDropMonitor(point: DesktopPoint) {
  const direct = await Promise.resolve()
    .then(() => monitorFromPoint(point.x, point.y))
    .catch(() => null);
  if (direct) return direct;
  const cursor = await Promise.resolve()
    .then(() => cursorPosition())
    .catch(() => null);
  const monitors = await Promise.resolve()
    .then(() => availableMonitors())
    .catch(() => []);
  const at = cursor ?? point;
  const distance = (monitor: Monitor) =>
    Math.hypot(
      Math.max(0, monitor.position.x - at.x, at.x - monitor.position.x - monitor.size.width),
      Math.max(0, monitor.position.y - at.y, at.y - monitor.position.y - monitor.size.height),
    );
  return monitors.reduce<Monitor | null>(
    (nearest, monitor) => (!nearest || distance(monitor) < distance(nearest) ? monitor : nearest),
    null,
  );
}

export async function keepDraggedWorkspaceReachable(point: DesktopPoint) {
  const current = getCurrentWindow();
  const [monitor, origin, size, maximized, fullscreen] = await Promise.all([
    workspaceDropMonitor(point),
    current.outerPosition(),
    current.outerSize(),
    current.isMaximized(),
    current.isFullscreen(),
  ]);
  if (!monitor || maximized || fullscreen) return;
  const next = reachableTitlebar(origin, size.width, monitor, isMacOS ? 42 : 38);
  if (next.x !== origin.x || next.y !== origin.y) await current.setPosition(new PhysicalPosition(next.x, next.y));
}

export async function dismissEmptyWorkspaceWindow(): Promise<void> {
  if (secondaryWorkspaceLabel()) await getCurrentWindow().destroy();
  else if (getCurrentWindow().label === 'main') await getCurrentWindow().hide();
}

type HandoffStatus = 'request' | 'ready' | 'failed' | { tabBounds: TabBounds };
const handoffEvent = (label: string) => `workspace-handoff:${label}`;
const handoffPayload = (label: string) => `workspace-payload:${label}`;
const handoffError = () => new Error(t('The new window could not receive this tab.'));
const offerEvent = 'workspace-tab-offer';
const settledEvent = (token: string) => `workspace-tab-settled:${token}`;
const appliedEvent = (token: string) => `workspace-tab-applied:${token}`;
const validToken = (token: string) => /^[a-f0-9-]{36}$/.test(token);

interface ExistingWindowOffer {
  source: string;
  token: string;
  placement?: DesktopPoint;
  dragId?: string;
  grabRatio?: number;
  contents: unknown;
}

/** Negotiate a move with an existing window through the same prepare-before-removal contract. */
export async function moveToExistingAppWindow(
  target: WorkspaceWindowTarget,
  contents: unknown,
  commit: (label: string) => void | Promise<void>,
  drop?: Promise<boolean>,
) {
  if (!drop) discardWarmedWorkspace();
  const payload = Promise.resolve(contents);
  void payload.catch(() => {});
  const canceled = Symbol();
  const withdrawn = drop?.then((accepted) => (accepted ? new Promise<never>(() => {}) : canceled));
  const source = getCurrentWindow().label;
  if (target.label === source || !validWorkspaceLabel(target.label)) throw handoffError();
  const window = (await otherWorkspaceWindows()).find((window) => window.label === target.label);
  if (!window) throw handoffError();
  const token = crypto.randomUUID();
  let stop: UnlistenFn | undefined;
  let stopApplied: UnlistenFn | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let appliedTimeout: ReturnType<typeof setTimeout> | undefined;
  let verifyTimeout: ReturnType<typeof setTimeout> | undefined;
  let offered = false;
  let accepted = false;
  let markListening!: () => void;
  let markApplied!: () => void;
  const listening = new Promise<void>((resolve) => {
    markListening = resolve;
  });
  const applied = new Promise<void>((resolve) => {
    markApplied = resolve;
  });
  try {
    let resolveReady!: (ready: boolean) => void;
    let verify!: (live: boolean) => void;
    const result = new Promise<boolean>((resolve) => {
      resolveReady = resolve;
    });
    const verified = new Promise<boolean>((resolve) => {
      verify = resolve;
    });
    await Promise.all([
      listen<boolean | 'listening' | 'verified'>(
        handoffEvent(token),
        (event) => {
          markListening();
          if (event.payload === 'verified') verify(true);
          else if (event.payload !== 'listening') resolveReady(event.payload === true);
        },
        { target: source },
      ).then((unlisten) => {
        stop = unlisten;
      }),
      listen(appliedEvent(token), () => markApplied(), { target: source }).then((unlisten) => {
        stopApplied = unlisten;
      }),
    ]);
    const contents = await (withdrawn ? Promise.race([payload, withdrawn]) : payload);
    if (contents === canceled) return false;
    const offer: ExistingWindowOffer = {
      source,
      token,
      placement: target.point,
      dragId: target.dragId,
      grabRatio: target.grabRatio,
      contents,
    };
    timeout = setTimeout(() => resolveReady(false), HANDOFF_TIMEOUT_MS);
    await emitTo(target.label, offerEvent, offer);
    offered = true;
    const ready = await (withdrawn ? Promise.race([result, withdrawn]) : result);
    if (ready === canceled) return false;
    if (!ready) throw handoffError();
    if (drop) {
      if (!(await drop)) return false;
      verifyTimeout = setTimeout(() => verify(false), 1500);
      await emitTo(target.label, settledEvent(token), 'verify');
      if (!(await verified)) throw handoffError();
    }
    if (!(await otherWorkspaceWindows()).some((window) => window.label === target.label)) throw handoffError();
    await commit(target.label);
    accepted = true;
  } finally {
    clearTimeout(timeout);
    clearTimeout(verifyTimeout);
    if (offered) {
      appliedTimeout = setTimeout(() => {
        markListening();
        markApplied();
      }, 1500);
      await listening;
      await emitTo(target.label, settledEvent(token), accepted).catch(markApplied);
      await applied;
    }
    stop?.();
    stopApplied?.();
    clearTimeout(appliedTimeout);
  }
  if (!target.dragId) void window.setFocus().catch(() => {});
  return true;
}

export async function focusWorkspaceWindow(label: string) {
  const window = (await otherWorkspaceWindows()).find((window) => window.label === label);
  await window?.setFocus();
}

export async function listenForWorkspaceTabMoves(
  prepare: (contents: unknown, placement?: DesktopPoint, dragId?: string, grabRatio?: number) => IncomingTabMove,
) {
  if (!isTauri()) return () => {};
  const target = getCurrentWindow().label;
  return listen<ExistingWindowOffer>(
    offerEvent,
    async ({ payload: offer }) => {
      if (
        !offer ||
        typeof offer.source !== 'string' ||
        !validWorkspaceLabel(offer.source) ||
        offer.source === target ||
        typeof offer.token !== 'string' ||
        !validToken(offer.token)
      )
        return;
      const dragId = typeof offer.dragId === 'string' && validToken(offer.dragId) ? offer.dragId : undefined;
      let transaction: IncomingTabMove | undefined;
      let stop: UnlistenFn | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let accepted = false;
      let prepared = false;
      try {
        let settle!: (value: boolean) => void;
        const result = new Promise<boolean>((resolve) => {
          settle = resolve;
        });
        stop = await listen<boolean | 'verify'>(
          settledEvent(offer.token),
          (event) => {
            if (event.payload === 'verify') {
              if (prepared && dragId) void emitTo(offer.source, handoffEvent(offer.token), 'verified').catch(() => {});
            } else settle(event.payload === true);
          },
          { target },
        );
        timer = setTimeout(() => settle(false), HANDOFF_TIMEOUT_MS + (dragId ? 30_000 : 0) + 5000);
        if (dragId) await emitTo(offer.source, handoffEvent(offer.token), 'listening');
        const grabRatio = typeof offer.grabRatio === 'number' && offer.grabRatio >= 0 && offer.grabRatio <= 1 ? offer.grabRatio : undefined;
        transaction = prepare(offer.contents, offer.placement, dragId, grabRatio);
        if (dragId) transaction.present?.();
        await Promise.race([
          transaction.ready,
          result.then(() => {
            throw handoffError();
          }),
        ]);
        prepared = true;
        await emitTo(offer.source, handoffEvent(offer.token), true);
        accepted = await result;
      } catch {
        await emitTo(offer.source, handoffEvent(offer.token), false).catch(() => {});
      } finally {
        stop?.();
        clearTimeout(timer);
        try {
          transaction?.finish(accepted);
        } finally {
          await emitTo(offer.source, appliedEvent(offer.token), null).catch(() => {});
        }
      }
    },
    { target },
  );
}

const workspaceOptions = () => ({
  title: 'Vrykell',
  width: 1040,
  height: 720,
  minWidth: 720,
  minHeight: 480,
  transparent: true,
  decorations: isMacOS,
  shadow: isMacOS,
  backgroundColor: '#00000000',
  ...(isMacOS && { titleBarStyle: 'overlay' as const, hiddenTitle: true, trafficLightPosition: new LogicalPosition(16, 19) }),
});

/** Open a separate workspace with a new terminal. */
export function openAppWindow() {
  return new WebviewWindow(`app-${crypto.randomUUID()}`, { ...workspaceOptions(), url: window.location.pathname, center: true });
}

async function createDetachedWorkspace(label = `app-${crypto.randomUUID()}`) {
  const started = performance.now();
  const source = getCurrentWindow().label;
  if (!validWorkspaceLabel(source)) throw handoffError();
  const url = `${window.location.pathname}?${new URLSearchParams({ [WORKSPACE_SOURCE_PARAM]: source })}`;
  let resolveRequest!: () => void;
  let resolveReady!: (bounds?: TabBounds) => void;
  let rejectReady!: (error: unknown) => void;
  let resolveCreated!: () => void;
  let rejectCreated!: (error: unknown) => void;
  let offered = false;
  let listeningForContents = false;
  const request = new Promise<void>((resolve) => {
    resolveRequest = resolve;
  });
  const ready = new Promise<TabBounds | undefined>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const created = new Promise<void>((resolve, reject) => {
    resolveCreated = resolve;
    rejectCreated = reject;
  });
  void ready.catch(() => {});
  void created.catch(() => {});
  const stop = await listen<HandoffStatus>(
    handoffEvent(label),
    ({ payload: status }) => {
      if (status === 'request') {
        listeningForContents = true;
        diagnostic('workspace-window-receiver-ready', { durationMs: Math.round(performance.now() - started) });
        resolveRequest();
      } else if (offered && status === 'ready') resolveReady();
      else if (offered && status && typeof status === 'object') {
        const bounds = status.tabBounds;
        const valid =
          bounds &&
          [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) &&
          bounds.x >= 0 &&
          bounds.y >= 0 &&
          bounds.width > 0 &&
          bounds.height > 0 &&
          bounds.y + bounds.height <= 64;
        resolveReady(valid ? bounds : undefined);
      } else if (status === 'failed') rejectReady(handoffError());
    },
    { target: source },
  );
  let child: WebviewWindow;
  try {
    child = new WebviewWindow(label, { ...workspaceOptions(), url, center: true, visible: false, focus: false });
  } catch (error) {
    stop();
    throw error;
  }
  const failCreation = () => {
    const error = handoffError();
    rejectCreated(error);
    rejectReady(error);
  };
  void child.once('tauri://created', resolveCreated).catch(failCreation);
  void child.once('tauri://error', failCreation).catch(failCreation);
  let destroyed = false;
  let preparedContents: Promise<TabBounds | undefined> | undefined;
  let offeredContents: unknown;
  let inset: Promise<DesktopPoint> | undefined;
  return {
    label,
    child,
    stop,
    created,
    listeningForContents: () => listeningForContents,
    frameInset: () =>
      (inset ??= Promise.resolve()
        .then(async () => {
          const [inner, outer, scale] = await Promise.all([child.innerPosition(), child.outerPosition(), child.scaleFactor()]);
          return { x: (inner.x - outer.x) / scale, y: (inner.y - outer.y) / scale };
        })
        .catch(() => ({ x: 0, y: 0 }))),
    destroy: async () => {
      if (destroyed) return;
      destroyed = true;
      rejectReady(handoffError());
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        created.catch(() => {}),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 1500);
        }),
      ]);
      clearTimeout(timer);
      failCreation();
      await child.destroy().catch(() => {});
    },
    accept: (payload: unknown) => {
      if (preparedContents) return payload === offeredContents ? preparedContents : Promise.reject(handoffError());
      offeredContents = payload;
      preparedContents = (async () => {
        const timer = setTimeout(() => rejectReady(handoffError()), HANDOFF_TIMEOUT_MS);
        try {
          void request
            .then(() => {
              if (destroyed) return;
              offered = true;
              return emitTo(label, handoffPayload(label), payload);
            })
            .catch(rejectReady);
          return await ready;
        } finally {
          clearTimeout(timer);
        }
      })();
      return preparedContents;
    },
  };
}

let warmWindow: ReturnType<typeof createDetachedWorkspace> | undefined;
let warmLabel: string | undefined;
let discardWarmWindow: ReturnType<typeof setTimeout> | undefined;
interface DetachedPreview {
  point: DesktopPoint;
  placedAt?: DesktopPoint;
  grip?: TabDragGrip;
  bounds?: TabBounds;
  payload?: Promise<unknown>;
  started: number;
  work?: Promise<void>;
  shown: boolean;
  visible: boolean;
  monitor?: Monitor | null;
}
let previewWindow: DetachedPreview | undefined;

const pointOnMonitor = (point: DesktopPoint, monitor: Monitor) =>
  point.x >= monitor.position.x &&
  point.x < monitor.position.x + monitor.size.width &&
  point.y >= monitor.position.y &&
  point.y < monitor.position.y + monitor.size.height;

export function discardWarmedWorkspace(onlyDuringDrag = false) {
  if (onlyDuringDrag && !previewWindow) return;
  clearTimeout(discardWarmWindow);
  const pending = warmWindow;
  warmWindow = undefined;
  warmLabel = undefined;
  previewWindow = undefined;
  document.documentElement.removeAttribute('data-workspace-drag-outside');
  return pending
    ?.then((window) => {
      window.stop();
      return window.destroy();
    })
    .catch(() => {});
}

/** Boot the hidden surface in parallel with the remainder of the pointer gesture. */
function warmDetachedWorkspace() {
  clearTimeout(discardWarmWindow);
  warmLabel ??= `app-${crypto.randomUUID()}`;
  warmWindow ??= createDetachedWorkspace(warmLabel);
  const pending = warmWindow;
  void pending.catch(() => {
    if (warmWindow === pending) {
      warmWindow = undefined;
      warmLabel = undefined;
    }
  });
  discardWarmWindow = setTimeout(discardWarmedWorkspace, DETACHED_WINDOW_WAIT_MS);
}

export function prewarmDetachedWorkspace() {
  if (canOpenWorkspaceWindow() && !warmWindow) warmDetachedWorkspace();
}

export function showDetachedWorkspaceAt(point: DesktopPoint, grip?: TabDragGrip, payload?: Promise<unknown>) {
  if (!previewWindow) warmDetachedWorkspace();
  const surface = (previewWindow ??= { point, grip, payload, started: performance.now(), shown: false, visible: true });
  surface.point = point;
  surface.visible = true;
  syncDetachedPreview(surface);
}

export function concealDetachedWorkspacePreview() {
  if (!previewWindow) return;
  previewWindow.visible = false;
  syncDetachedPreview(previewWindow);
}

function previewAnchor(grip?: TabDragGrip, bounds?: TabBounds) {
  if (!grip || !bounds) return;
  return { x: bounds.x + bounds.width * grip.ratio, y: bounds.y + Math.min(grip.offsetY, bounds.height - 1) };
}

function syncDetachedPreview(surface: DetachedPreview) {
  const pending = warmWindow;
  if (!pending) return;
  if (surface.work) return;
  let synchronized = false;
  surface.work = pending
    .then(async ({ child, created, accept, frameInset }) => {
      await created;
      if (previewWindow !== surface) return;
      const contents = surface.shown
        ? undefined
        : Promise.all([child.setIgnoreCursorEvents(true).catch(() => {}), surface.payload?.then(accept)]);
      void contents?.catch(() => {});
      while (previewWindow === surface) {
        if (!surface.visible) {
          if (surface.shown) await child.hide();
          surface.shown = false;
          if (surface.visible) continue;
          break;
        }
        if (contents) surface.bounds = (await contents)[1];
        if (previewWindow !== surface || !surface.visible) continue;
        const at = surface.point;
        const monitor = surface.monitor;
        if (!monitor || !pointOnMonitor(at, monitor)) {
          surface.monitor = await workspaceDropMonitor(at);
        }
        if (previewWindow !== surface) return;
        const anchor = previewAnchor(surface.grip, surface.bounds);
        await placeDetachedWorkspace(child, at, surface.monitor ?? null, anchor, anchor && (await frameInset()));
        surface.placedAt = at;
        if (previewWindow !== surface) return;
        if (!surface.shown && surface.visible) {
          document.documentElement.setAttribute('data-workspace-drag-outside', '');
          try {
            await child.show();
          } catch (error) {
            if (previewWindow === surface && surface.visible) document.documentElement.removeAttribute('data-workspace-drag-outside');
            throw error;
          }
          surface.shown = true;
          diagnostic('workspace-window-preview-visible', { durationMs: Math.round(performance.now() - surface.started) });
        }
        if (at === surface.point && surface.visible) break;
      }
      synchronized = true;
    })
    .catch(() => {})
    .finally(() => {
      surface.work = undefined;
      if (
        synchronized &&
        previewWindow === surface &&
        (surface.visible !== surface.shown || (surface.visible && surface.point !== surface.placedAt))
      )
        syncDetachedPreview(surface);
    });
}

async function placeDetachedWorkspace(
  child: WebviewWindow,
  point: DesktopPoint | undefined,
  monitor: Monitor | null,
  anchor?: DesktopPoint,
  inset = { x: 0, y: 0 },
) {
  if (!point || !monitor) return;
  const options = workspaceOptions();
  const size = {
    width: Math.max(options.minWidth, Math.min(options.width, Math.floor(monitor.workArea.size.width / monitor.scaleFactor))),
    height: Math.max(options.minHeight, Math.min(options.height, Math.floor(monitor.workArea.size.height / monitor.scaleFactor))),
  };
  const position = anchor ? grabbedTabPlacement(point, monitor, size.width, anchor) : detachedWindowPlacement(point, monitor, size);
  // A compositor can decline client-managed positions. The window still opens in its default slot.
  await child
    .setPosition(
      new PhysicalPosition(Math.round(position.x - inset.x * monitor.scaleFactor), Math.round(position.y - inset.y * monitor.scaleFactor)),
    )
    .catch(() => {});
  if (size.width !== options.width || size.height !== options.height) {
    await child.setSize(new LogicalSize(size.width, size.height)).catch(() => {});
  }
}

/** Keep the source intact until the receiving surface is ready. */
export async function moveToNewAppWindow(
  payload: unknown,
  commit: (label: string) => void | Promise<void>,
  point?: DesktopPoint,
  grip?: TabDragGrip,
) {
  const releasedAt = performance.now();
  const prepared = Promise.resolve(payload);
  void prepared.catch(() => {});
  clearTimeout(discardWarmWindow);
  const pending = warmWindow;
  const preview = previewWindow;
  const monitor =
    point && (!preview?.monitor || !pointOnMonitor(point, preview.monitor))
      ? workspaceDropMonitor(point)
      : Promise.resolve(preview?.monitor ?? null);
  warmWindow = undefined;
  warmLabel = undefined;
  previewWindow = undefined;
  const workspace = await (pending ?? createDetachedWorkspace());
  const { label, child } = workspace;
  const receiverReady = workspace.listeningForContents();
  try {
    const accept = prepared.then(workspace.accept).then((bounds) => {
      diagnostic('workspace-window-content-ready', {
        fromPointer: !!point,
        receiverReady,
        durationMs: Math.round(performance.now() - releasedAt),
      });
      return bounds;
    });
    const display = async () => {
      await workspace.created;
      if (!preview?.shown) await child.setIgnoreCursorEvents(true).catch(() => {});
      await preview?.work;
      if (!preview?.shown || point?.x !== preview.placedAt?.x || point?.y !== preview.placedAt?.y) {
        const anchor = previewAnchor(preview?.grip ?? grip, await accept);
        await placeDetachedWorkspace(child, point, await monitor, anchor, anchor && (await workspace.frameInset()));
      }
      await accept;
      if (!preview?.shown) await child.show();
      diagnostic('workspace-window-visible', {
        fromPointer: !!point,
        prewarmed: !!pending,
        durationMs: Math.round(performance.now() - releasedAt),
      });
    };
    await Promise.all([display(), accept]);
    if (!(await child.isVisible())) throw handoffError();
    await commit(label);
    await emitTo(label, settledEvent(label), true);
    await child.setIgnoreCursorEvents(false).catch(() => {});
    void child.setFocus().catch(() => {});
  } catch (error) {
    await workspace.destroy();
    throw error;
  } finally {
    workspace.stop();
  }
}

export async function receiveWorkspaceHandoff(
  route: NonNullable<ReturnType<typeof detachedWorkspaceRoute>>,
  prepare: (payload: unknown) => IncomingTabMove,
) {
  const { label, source } = route;
  let stop: UnlistenFn | undefined;
  let stopSettled: UnlistenFn | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let transaction: IncomingTabMove | undefined;
  let accepted = false;
  try {
    let resolvePayload!: (payload: unknown) => void;
    let settle!: (accepted: boolean) => void;
    const payload = new Promise<unknown>((resolve) => {
      resolvePayload = resolve;
    });
    const settled = new Promise<boolean>((resolve) => {
      settle = resolve;
    });
    const failed = settled.then(() => {
      throw handoffError();
    });
    void failed.catch(() => {});
    stop = await listen<unknown>(handoffPayload(label), (event) => resolvePayload(event.payload), { target: label });
    stopSettled = await listen<boolean>(settledEvent(label), (event) => settle(event.payload === true), { target: label });
    timeout = setTimeout(() => settle(false), DETACHED_WINDOW_WAIT_MS + HANDOFF_TIMEOUT_MS);
    await emitTo(source, handoffEvent(label), 'request' satisfies HandoffStatus);
    const contents = await Promise.race([payload, failed]);
    useWorkspaceWindowStaging.setState({ staged: true });
    transaction = prepare(contents);
    transaction.present?.();
    await Promise.race([transaction.ready, failed]);
    const bounds = transaction.tabBounds?.();
    await emitTo(source, handoffEvent(label), (bounds ? { tabBounds: bounds } : 'ready') satisfies HandoffStatus);
    accepted = await settled;
    if (!accepted) throw handoffError();
  } catch (error) {
    await emitTo(source, handoffEvent(label), 'failed' satisfies HandoffStatus).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timeout);
    stop?.();
    stopSettled?.();
    transaction?.finish(accepted);
    if (accepted) useWorkspaceWindowStaging.setState({ staged: false });
  }
}
