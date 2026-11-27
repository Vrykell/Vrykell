import { editorFileKey } from '@core/editor';
import { gitComparisonKey } from '@core/git';
import { t } from '@i18n';
import {
  canOpenWorkspaceWindow,
  clientPointToDesktop,
  concealDetachedWorkspacePreview,
  discardWarmedWorkspace,
  dismissEmptyWorkspaceWindow,
  focusWorkspaceWindow,
  keepDraggedWorkspaceReachable,
  moveToExistingAppWindow,
  moveToNewAppWindow,
  prewarmDetachedWorkspace,
  showDetachedWorkspaceAt,
  trackWorkspaceDrag,
  workspacePointMapper,
  type DesktopPoint,
  type IncomingTabMove,
  type TabDragGrip,
  type WorkspaceWindowTarget,
} from '@platform/appWindows';
import { movePtySessions, ptyInputEpoch } from '@platform/pty';
import { diagnostic } from '@platform/diagnostics';
import { useWorkspaceWindowStaging } from '@platform/workspaceWindowIdentity';
import { flushEditorChanges } from '@ui/editor/code/pendingChanges';
import { startHeldListReorder, useListReorder } from '@ui/layout/listReorder';
import type { TrackWindowTabDrag } from '@ui/layout/GroupedTabList';
import { useEditorDocuments } from '@features/editor/stores/documents';
import { useBlockStore } from '@features/terminal/stores/blocks';
import { useInputStore } from '@features/terminal/stores/input';
import { useTerminalStore } from '@features/terminal/stores/terminal';
import {
  discardTerminalHandoffs,
  readTerminalHandoff,
  releaseTerminalHandoff,
  stageTerminalHandoffs,
} from '@features/terminal/services/windowHandoff';
import { useChatStore } from '@features/chat/stores/chat';
import { useAiWorkspace } from '@features/chat/stores/aiWorkspace';
import { useComposerDrafts } from '@features/chat/stores/composerDrafts';
import { useHarnessWorkspace } from '@features/chat/stores/harnessWorkspace';
import { useHarnessStore } from '@features/chat/stores/harness';
import { flushHarnessTranscripts } from '@features/chat/services/harnessTranscriptRuntime';
import { sanitizeOutputHtml } from '@utils/sanitizeHtml';
import { panesOf, putContainer, releaseContainerResources, removeContainers, type WorkspaceContainer } from '../model/workbench';
import { firstLeaf, leaves, removeLeaf } from '../model/windowLayout';
import { terminalWorkspaceLayout } from '../model/workspaceResources';
import { parseGroupWindowHandoff, parseWindowHandoff, terminalTabsInHandoff, type TabWindowHandoff } from '../model/windowHandoff';
import { useWorkbenchStore } from '../stores/workbench';
import { isSessionTab, useWorkspaceStore, type Tab } from '../stores/workspace';
import { useWorkspaceNavigation } from '../stores/navigation';
import { reportWorkbenchFailure } from '../stores/workbenchFeedback';
import { activateContainer, runWithoutWorkbenchSync, synchronizeWorkbench } from './workbench';
import { create as createSessionDraft, forgetSessionDraft, sessionDraftTimestamp } from './sessionManager';
import { currentWorkspaceResources, hasWorkspaceWindowContent } from './workspaceResources';

const moving = new Set<string>();
const findTab = (id: string) => useWorkbenchStore.getState().snapshot.tabs.find((tab) => tab.id === id);
const findGroup = (id: string) => useWorkbenchStore.getState().snapshot.groups.find((group) => group.id === id);
const unavailable = () => new Error(t('The tab changed before the move could finish.'));

function canMoveTab(tab: WorkspaceContainer) {
  return !!tab.layout;
}
export function canMoveTabToNewWindow(id: string) {
  if (!canOpenWorkspaceWindow()) return false;
  const tab = findTab(id);
  if (tab) return canMoveTab(tab);
  const group = findGroup(id);
  const members = useWorkbenchStore.getState().snapshot.tabs.filter((tab) => tab.groupId === group?.id);
  return !!group && !!members.length && members.every(canMoveTab);
}

export function canDragTabAcrossWindows(id: string) {
  return canMoveTabToNewWindow(id) && hasOtherWorkspaceResources(id);
}

function hasOtherWorkspaceResources(id: string) {
  const tabs = useWorkbenchStore.getState().snapshot.tabs;
  const owned = new Set(
    tabs.filter((tab) => tab.id === id || tab.groupId === id).flatMap((tab) => panesOf(tab).map((pane) => pane.resourceId)),
  );
  return hasWorkspaceWindowContent(owned);
}

function createWorkspaceDragVisit(id: string) {
  let visit: { label: string; settle: (accept: boolean) => void; move: ReturnType<typeof moveTabToNewWindow> } | undefined;
  const prior = new Map<string, ReturnType<typeof moveTabToNewWindow>>();
  const leave = () => {
    visit?.settle(false);
    visit = undefined;
  };
  return {
    enter: (target?: WorkspaceWindowTarget, prepared?: ReturnType<typeof prepareOutgoingWindowTab>) => {
      leave();
      if (!target) return;
      let settle!: (accept: boolean) => void;
      let withdrawn = false;
      const drop = new Promise<boolean>((resolve) => {
        settle = (accept) => {
          withdrawn = !accept;
          resolve(accept);
        };
      });
      const move = Promise.resolve(prior.get(target.label)).then(() =>
        withdrawn ? false : moveTabToNewWindow(id, undefined, target, prepared, { drop }),
      );
      prior.set(target.label, move);
      visit = { label: target.label, settle, move };
    },
    finish: (target: WorkspaceWindowTarget, prepared?: ReturnType<typeof prepareOutgoingWindowTab>) => {
      if (visit?.label === target.label) {
        visit.settle(true);
        return visit.move;
      }
      leave();
      return moveTabToNewWindow(id, undefined, target, prepared);
    },
    leave,
  };
}

export function beginSingleTabWindowDrag(id: string, grabRatio?: number): boolean {
  if (!canOpenWorkspaceWindow()) return false;
  const movable = canMoveTabToNewWindow(id);
  if (hasOtherWorkspaceResources(id)) return false;
  const visits = createWorkspaceDragVisit(id);
  const gesture = trackWorkspaceDrag(true, movable, grabRatio, visits.enter);
  const end = async (point: Awaited<typeof gesture.nativeRelease>) => {
    try {
      const { target } = await gesture.dropAt(point);
      gesture.finish(point, target);
      if (target && (await visits.finish(target))) return;
      visits.leave();
      if (point) await keepDraggedWorkspaceReachable(point).catch(() => {});
    } finally {
      await gesture.restore(point);
    }
  };
  void gesture.nativeRelease.then(end, (error) => {
    visits.leave();
    gesture.cancel();
    reportWorkbenchFailure(error, () => {
      beginSingleTabWindowDrag(id, grabRatio);
    });
  });
  return true;
}

interface TabGesture {
  id: string;
  tracking: ReturnType<typeof trackWorkspaceDrag>;
  detaching: boolean;
  claimed: boolean;
  captureLost: boolean;
  visits: ReturnType<typeof createWorkspaceDragVisit>;
  grip?: TabDragGrip;
  prepared?: ReturnType<typeof prepareOutgoingWindowTab>;
  sourceReorder?: ReturnType<typeof startHeldListReorder>;
  toDesktop?: (point: DesktopPoint) => DesktopPoint;
  latest: DesktopPoint;
}
let tabGesture: TabGesture | undefined;

const clearTabGesture = (active: TabGesture) => {
  active.tracking.cancel();
  active.visits.leave();
  active.sourceReorder?.cancel();
  if (tabGesture === active) {
    useListReorder.setState({ externalDragSourceId: null });
    tabGesture = undefined;
    discardWarmedWorkspace(true);
    document.documentElement.removeAttribute('data-workspace-drag-outside');
  }
};

function reopenSourceStrip(active: TabGesture, point: DesktopPoint, grabRatio?: number) {
  if (active.detaching) {
    discardWarmedWorkspace(true);
    active.prepared = undefined;
  }
  active.detaching = false;
  document.documentElement.removeAttribute('data-workspace-drag-outside');
  if (!active.captureLost) return;
  if (active.sourceReorder) active.sourceReorder.move(point);
  else active.sourceReorder = startWorkspaceStripReorder(active.id, point, grabRatio);
}

function showMovingTab(active: TabGesture, point: DesktopPoint) {
  active.prepared ??= prepareOutgoingWindowTab(active.id);
  if (active.prepared) showDetachedWorkspaceAt(point, active.grip, active.prepared.payload);
}

export const trackDetachedWorkspaceTab: TrackWindowTabDrag = (id, event) => {
  if (event.type === 'start') {
    if (tabGesture) clearTabGesture(tabGesture);
    if (canDragTabAcrossWindows(id)) prewarmDetachedWorkspace();
    return;
  }
  if (event.type === 'end') {
    const active = tabGesture?.id === id ? tabGesture : undefined;
    if (!active) return;
    if (event.reason === 'capture-lost' && !active.claimed) active.captureLost = true;
    else if (!active.claimed && (event.reason === 'canceled' || !active.tracking.observedNative())) clearTabGesture(active);
    return;
  }
  if (!tabGesture) {
    if (!canDragTabAcrossWindows(id)) return;
    const tracking = trackWorkspaceDrag(
      false,
      true,
      event.grabRatio,
      (target) => {
        if (target) {
          active.sourceReorder?.cancel();
          active.sourceReorder = undefined;
          document.documentElement.setAttribute('data-workspace-drag-outside', '');
          concealDetachedWorkspacePreview();
        }
        active.visits.enter(target, active.prepared);
      },
      (point, outside, client, sourceStrip) => {
        if (client && sourceStrip) {
          reopenSourceStrip(active, client, event.grabRatio);
          return;
        }
        if (active.claimed) return;
        if (outside || active.detaching || (client && event.tearOffY !== undefined && client.y >= event.tearOffY)) {
          active.sourceReorder?.cancel();
          active.sourceReorder = undefined;
          active.detaching = true;
          showMovingTab(active, point);
        }
      },
    );
    useListReorder.setState({ externalDragSourceId: id });
    const active: TabGesture = {
      id,
      tracking,
      visits: createWorkspaceDragVisit(id),
      grip: event.grip,
      detaching: false,
      claimed: false,
      captureLost: false,
      latest: event.point,
    };
    tabGesture = active;
    void workspacePointMapper()
      .then((map) => {
        active.toDesktop = map;
        tracking.update(map(active.latest));
      })
      .catch(() => {});
    void tracking.nativeRelease
      .then(async (point) => {
        if (tabGesture !== active || active.claimed) return;
        if (!point && !tracking.observedNative()) return;
        const { target, outside, sourcePoint } = await tracking.dropAt(point);
        if (tabGesture !== active || active.claimed) return;
        if (sourcePoint) {
          if (document.documentElement.hasAttribute('data-workspace-drag-outside')) active.captureLost = true;
          reopenSourceStrip(active, sourcePoint, event.grabRatio);
          active.sourceReorder?.finish();
          clearTabGesture(active);
          return;
        }
        // A captured renderer can lose focus before the desktop sends the button release.
        if (point && (target || outside || active.detaching)) {
          active.claimed = true;
          if (!canDragTabAcrossWindows(id)) {
            clearTabGesture(active);
            return;
          }
          tracking.finish(point, target);
          if (useListReorder.getState().drag?.id === id) useListReorder.getState().end();
          if (target) await active.visits.finish(target, active.prepared);
          else {
            active.visits.leave();
            await moveTabToNewWindow(id, point, undefined, active.prepared, { grip: active.grip });
          }
        }
        clearTabGesture(active);
      })
      .catch(() => {
        if (active.captureLost || tracking.observedNative()) clearTabGesture(active);
      });
  }
  if (tabGesture.id !== id || tabGesture.claimed) return;
  tabGesture.latest = event.point;
  // Native samples remain authoritative when the detached window overlaps the captured webview.
  if (tabGesture.tracking.observedNative()) return;
  const startingDetach = event.detaching && !tabGesture.detaching;
  if (!event.detaching && tabGesture.detaching) {
    discardWarmedWorkspace(true);
    tabGesture.prepared = undefined;
  }
  tabGesture.detaching = event.detaching;
  if (tabGesture.toDesktop) {
    const point = tabGesture.toDesktop(event.point);
    if (event.detaching && (startingDetach || !tabGesture.prepared)) showMovingTab(tabGesture, point);
    tabGesture.tracking.update(point);
  }
};

export function dropWorkspaceTab(id: string, point: DesktopPoint, client: DesktopPoint) {
  const active = tabGesture?.id === id ? tabGesture : undefined;
  if (active?.claimed) return;
  if (active?.tracking.observedNative()) return;
  if (!canDragTabAcrossWindows(id)) {
    if (active) clearTabGesture(active);
    return;
  }
  if (active) active.claimed = true;
  const tracking = active?.tracking ?? trackWorkspaceDrag(false, true);
  const map = active?.toDesktop;
  void (map ? Promise.resolve(map(client)) : clientPointToDesktop(client).catch(() => point)).then(async (physical) => {
    const at = physical;
    const { target, sourcePoint } = await tracking.dropAt(at);
    if (sourcePoint) {
      if (active) clearTabGesture(active);
      return;
    }
    if (!canDragTabAcrossWindows(id)) {
      if (active) clearTabGesture(active);
      else tracking.cancel();
      return;
    }
    tracking.finish(at, target);
    void moveTabToNewWindow(id, at, target, active?.prepared, { grip: active?.grip }).finally(() => {
      if (active) clearTabGesture(active);
    });
  });
}

interface OutgoingTab {
  payload: TabWindowHandoff;
  validate: () => void | Promise<void>;
  release: () => void;
}

async function readSettledTerminal(paneId: string) {
  let snapshot = readTerminalHandoff(paneId);
  const deadline = performance.now() + 2500;
  while (
    !snapshot &&
    performance.now() < deadline &&
    (useTerminalStore.getState().startupStates[paneId] === 'starting' ||
      useBlockStore.getState().byTab[paneId]?.some((block) => block.snapshotPending))
  ) {
    // Let initial prompt detection or the final xterm write settle before taking the snapshot.
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    snapshot = readTerminalHandoff(paneId);
  }
  return snapshot;
}

async function readOutgoingTerminal(id: string, paneIds?: ReadonlySet<string>): Promise<OutgoingTab> {
  const initial = useWorkspaceStore.getState().tabs.find((tab) => tab.id === id);
  if (!initial || !isSessionTab(initial)) throw unavailable();
  const conversation = useChatStore.getState();
  if (conversation.sendingTabs.includes(id)) throw unavailable();
  const panes = leaves(initial.layout);
  const specs = panes.filter((pane) => !paneIds || paneIds.has(pane.id));
  if (!specs.length) throw unavailable();
  const whole = specs.length === panes.length;
  const atPrompt = () => new Error(t('A terminal can move to a new window when it is at a command prompt in block mode.'));
  const original = await Promise.all(
    specs.map(async (pane) => {
      const snapshot = await readSettledTerminal(pane.id);
      if (!snapshot) {
        const terminal = useTerminalStore.getState();
        diagnostic('workspace-terminal-handoff-unavailable', {
          startupState: terminal.startupStates[pane.id],
          scene: terminal.scenes[pane.id],
          fullscreen: !!terminal.manualFullscreen[pane.id],
        });
        throw atPrompt();
      }
      return snapshot;
    }),
  );
  const [terminals, draftTimestamp] = await Promise.all([
    Promise.all(original.map(async (pane) => ({ ...pane, inputEpoch: await ptyInputEpoch(pane.sessionId) }))),
    whole ? sessionDraftTimestamp(id) : undefined,
  ]);
  // Startup can populate the directory while the terminal waits for its first prompt.
  const source = useWorkspaceStore.getState().tabs.find((tab) => tab.id === id);
  if (
    !source ||
    !isSessionTab(source) ||
    source.groupId !== initial.groupId ||
    (source.layout !== initial.layout &&
      JSON.stringify(terminalWorkspaceLayout(source.layout)) !== JSON.stringify(terminalWorkspaceLayout(initial.layout)))
  ) {
    diagnostic('workspace-terminal-handoff-changed', { reason: 'layout' });
    throw unavailable();
  }
  let layout = source.layout;
  for (const pane of panes) {
    if (paneIds && !paneIds.has(pane.id)) {
      const next = removeLeaf(layout, pane.id);
      if (!next) throw unavailable();
      layout = next;
    }
  }
  const destinationId = whole ? id : `session-${crypto.randomUUID()}`;
  const focused = useTerminalStore.getState().focusedPaneId;
  const payload = parseWindowHandoff({
    version: 1,
    id: destinationId,
    scope: 'terminal',
    layout,
    title: source.title,
    titleSource: source.titleSource,
    terminals,
    draftTimestamp,
    focused: specs.some((pane) => pane.id === focused) ? focused : firstLeaf(layout).id,
  });
  if (!payload || payload.scope !== 'terminal') throw new Error(t('This tab is too large to move to a new window.'));
  return {
    payload,
    validate: async () => {
      if (whole && (await sessionDraftTimestamp(id)) !== draftTimestamp) {
        diagnostic('workspace-terminal-handoff-changed', { reason: 'draft' });
        throw unavailable();
      }
      const state = useWorkspaceStore.getState();
      if (state.tabs.find((tab) => tab.id === id) !== source || useChatStore.getState().sendingTabs.includes(id)) {
        diagnostic('workspace-terminal-handoff-changed', { reason: 'tab' });
        throw unavailable();
      }
      if (
        original.some((pane) => {
          const latest = readTerminalHandoff(pane.paneId);
          return (
            !latest ||
            latest.sessionId !== pane.sessionId ||
            latest.cwd !== pane.cwd ||
            latest.draft !== pane.draft ||
            latest.blocks.length !== pane.blocks.length ||
            latest.blocks.some((block, index) => pane.blocks[index] !== block)
          );
        })
      ) {
        diagnostic('workspace-terminal-handoff-changed', { reason: 'pane' });
        throw unavailable();
      }
    },
    release: () => {
      for (const pane of terminals) releaseTerminalHandoff(pane.paneId, pane.sessionId);
      if (whole) {
        forgetSessionDraft(id);
        useWorkspaceStore.getState().closeTab(id, true, 'move');
      } else {
        for (const pane of specs) {
          const workspace = useWorkspaceStore.getState();
          const remaining = workspace.tabs.find((tab) => tab.id === id);
          if (remaining && isSessionTab(remaining) && remaining.layout.type === 'leaf' && remaining.layout.terminal.id === pane.id) {
            forgetSessionDraft(id);
            workspace.closeTab(id, true, 'move');
          } else workspace.closeTerminal(pane.id);
        }
      }
    },
  };
}

const comparisonsIn = (tabs: Tab[]) =>
  tabs.flatMap((tab) => (tab.kind === 'git-diff' ? (tab.comparisons ?? [{ id: tab.id, selection: tab.selection }]) : []));
const agentIsBusy = (session: ReturnType<typeof useHarnessStore.getState>['byTab'][string] | undefined) =>
  !!(session?.pending || session?.opening || session?.stopping || session?.permission || session?.queuedInputs?.length);

async function readOutgoingComposition(tab: WorkspaceContainer): Promise<OutgoingTab> {
  const ids = panesOf(tab).map((pane) => pane.resourceId);
  const before = useEditorDocuments.getState().documents;
  const keys = ids.filter((id) => id.startsWith('file:')).map((id) => id.slice(5));
  const documents = keys.map((key) => before[key]);
  if (documents.some((item) => !item || item.saving || item.loading)) throw unavailable();
  const conversationIds = ids.filter((id) => id.startsWith('chat:')).map((id) => id.slice(5));
  const chat = useChatStore.getState();
  const conversations = conversationIds.map((id) => chat.conversations.find((item) => item.id === id));
  if (
    conversations.some((item) => !item) ||
    conversationIds.some((id) => chat.sendingTabs.includes(id) || chat.queuedSends.some((item) => item.ownerId === id))
  )
    throw unavailable();
  const agentIds = ids.filter((id) => id.startsWith('acp:')).map((id) => id.slice(4));
  const agents = useHarnessWorkspace.getState().connections.filter((item) => agentIds.includes(item.id));
  const sessions = useHarnessStore.getState().byTab;
  if (agents.length !== agentIds.length || agentIds.some((id) => agentIsBusy(sessions[id]))) throw unavailable();
  const drafts = useComposerDrafts.getState().byTab;
  const comparisons = comparisonsIn(useWorkspaceStore.getState().tabs).filter((item) => ids.includes(`diff:${item.id}`));
  const terminalOwners = new Map<string, Set<string>>();
  for (const resource of currentWorkspaceResources()) {
    if (resource.kind !== 'terminal' || !resource.paneId || !ids.includes(resource.id)) continue;
    let panes = terminalOwners.get(resource.tabId);
    if (!panes) terminalOwners.set(resource.tabId, (panes = new Set()));
    panes.add(resource.paneId);
  }
  const [transfers] = await Promise.all([
    Promise.all([...terminalOwners].map(([id, panes]) => readOutgoingTerminal(id, panes))),
    Promise.all(conversationIds.map((id) => chat.flushForWindowMove(id))),
    agents.length ? flushHarnessTranscripts() : undefined,
  ]);
  const payload = parseWindowHandoff({
    version: 1,
    id: tab.id,
    scope: tab.scope,
    title: tab.title,
    focused: tab.focused,
    layout: tab.layout,
    documents,
    terminals: transfers.map((transfer) => transfer.payload),
    comparisons,
    conversations: conversations.map((item) => ({ ...item, draft: drafts[item!.id] })),
    agents: agents.map((item) => {
      const session = sessions[item.id];
      return {
        id: item.id,
        harness: item.harness,
        cwd: session?.cwd || item.cwd,
        resumeSessionId: session?.transcriptSessionId ?? session?.sessionId ?? item.resumeSessionId,
        draft: drafts[item.id],
      };
    }),
  });
  if (!payload || payload.scope === 'terminal') throw new Error(t('This tab is too large to move to a new window.'));
  return {
    payload,
    validate: async () => {
      await Promise.all(transfers.map((transfer) => transfer.validate()));
      const current = findTab(tab.id);
      const latest = useEditorDocuments.getState().documents;
      const latestChat = useChatStore.getState();
      const latestDrafts = useComposerDrafts.getState().byTab;
      const latestAgents = useHarnessWorkspace.getState().connections;
      const latestSessions = useHarnessStore.getState().byTab;
      const latestComparisons = comparisonsIn(useWorkspaceStore.getState().tabs);
      if (
        !current ||
        current.layout !== tab.layout ||
        current.title !== tab.title ||
        keys.some((key) => before[key] !== latest[key]) ||
        [...conversationIds, ...agentIds].some((id) => drafts[id] !== latestDrafts[id]) ||
        conversationIds.some(
          (id, index) =>
            latestChat.sendingTabs.includes(id) ||
            latestChat.byTab[id] !== chat.byTab[id] ||
            !latestChat.conversations.includes(conversations[index]!),
        ) ||
        agents.some((item) => !latestAgents.includes(item) || sessions[item.id] !== latestSessions[item.id]) ||
        comparisons.some((item) => !latestComparisons.some((other) => item.id === other.id && item.selection === other.selection))
      )
        throw unavailable();
    },
    release: () => {
      const workspace = useWorkspaceStore.getState();
      for (const transfer of transfers) transfer.release();
      for (const item of payload.documents) workspace.closeEditorFile(item.file, true);
      for (const item of comparisons) workspace.closeGitComparison(item.id);
      for (const id of conversationIds) {
        useAiWorkspace.getState().closeNative(id);
        chat.dropTab(id);
      }
      useHarnessWorkspace.getState().close(agentIds);
      useWorkspaceStore.setState({ lastClosed: workspace.lastClosed });
    },
  };
}

function prepareOutgoingWindowTab(id: string) {
  if (!canMoveTabToNewWindow(id)) return;
  const snapshot = useWorkbenchStore.getState().snapshot;
  const group = findGroup(id);
  const tabs = group ? snapshot.tabs.filter((tab) => tab.groupId === id) : snapshot.tabs.filter((tab) => tab.id === id);
  const ids = [...new Set([id, ...tabs.map((tab) => tab.id), ...tabs.flatMap((tab) => panesOf(tab).map((pane) => pane.resourceId))])];
  if (ids.some((id) => moving.has(id))) return;

  flushEditorChanges();
  const scope = tabs[0]?.scope;
  const started = performance.now();
  const transfers = Promise.all(
    tabs.map((tab) => (tab.scope === 'terminal' ? readOutgoingTerminal(tab.id) : readOutgoingComposition(tab))),
  );
  const selected = group && snapshot.selected[group.scope];
  const payload = transfers.then((items) => {
    const packet = group
      ? parseGroupWindowHandoff({
          version: 1,
          group,
          tabs: items.map((tab) => tab.payload),
          selected: selected && ids.includes(selected) ? selected : undefined,
          color: useWorkspaceNavigation.getState().groupColors[id],
        })
      : items[0]?.payload;
    if (!packet) throw new Error(t('This tab is too large to move to a new window.'));
    diagnostic('workspace-window-snapshot-ready', { scope, durationMs: Math.round(performance.now() - started) });
    return packet;
  });
  void payload.catch(() => {});
  return {
    ids,
    scope,
    payload,
    commit: async (label: string) => {
      const items = await transfers;
      flushEditorChanges();
      if (group) {
        const latest = findGroup(id);
        const members = useWorkbenchStore.getState().snapshot.tabs.filter((tab) => tab.groupId === id);
        if (
          !latest ||
          latest.title !== group.title ||
          latest.collapsed !== group.collapsed ||
          members.length !== tabs.length ||
          members.some((tab, index) => tab.id !== tabs[index]?.id)
        )
          throw unavailable();
      }
      await Promise.all(items.map((transfer) => transfer.validate()));
      const terminals = items.flatMap(({ payload }) =>
        terminalTabsInHandoff(payload).flatMap((tab) =>
          tab.terminals.map((pane) => ({ id: pane.sessionId, inputEpoch: pane.inputEpoch, tabId: tab.id })),
        ),
      );
      if (terminals.length) await movePtySessions(label, terminals);
      runWithoutWorkbenchSync(() => {
        for (const transfer of items) transfer.release();
        if (group) {
          useWorkbenchStore.getState().update((state) => ({ ...state, groups: state.groups.filter((item) => item.id !== id) }));
          useWorkspaceStore.setState((state) => ({ groups: state.groups.filter((item) => item.id !== id) }));
        }
      });
    },
  };
}

/** Remove originals only after the receiving window is ready. */
export async function moveTabToNewWindow(
  id: string,
  point?: DesktopPoint,
  target?: WorkspaceWindowTarget,
  prepared?: ReturnType<typeof prepareOutgoingWindowTab>,
  { drop, grip }: { drop?: Promise<boolean>; grip?: TabDragGrip } = {},
) {
  const started = performance.now();
  let outgoing: ReturnType<typeof prepareOutgoingWindowTab>;
  try {
    outgoing = prepared ?? prepareOutgoingWindowTab(id);
    if (!outgoing || outgoing.ids.some((id) => moving.has(id))) return;
    const { payload, commit, scope, ids } = outgoing;
    let ownsTransfer = !drop;
    if (ownsTransfer) for (const id of ids) moving.add(id);
    try {
      diagnostic('workspace-window-move-start', { scope, fromPointer: !!point || !!target?.dragId, merging: !!target });
      if (target) {
        const accepted = await moveToExistingAppWindow(
          target,
          payload,
          async (label) => {
            if (drop) {
              if (ids.some((id) => moving.has(id))) throw unavailable();
              for (const id of ids) moving.add(id);
              ownsTransfer = true;
            }
            await commit(label);
          },
          drop,
        );
        if (!accepted) return false;
      } else await moveToNewAppWindow(payload, commit, point, grip);
      diagnostic('workspace-window-move-complete', { scope, durationMs: Math.round(performance.now() - started) });
      if (target?.dragId) await focusWorkspaceWindow(target.label).catch(() => {});
      if (target && !hasWorkspaceWindowContent()) {
        await dismissEmptyWorkspaceWindow().catch(() => {});
      }
      return true;
    } finally {
      if (ownsTransfer) for (const id of ids) moving.delete(id);
    }
  } catch (error) {
    if (drop && !(await drop)) return false;
    diagnostic('workspace-window-move-failed', { scope: findTab(id)?.scope });
    reportWorkbenchFailure(error, () => moveTabToNewWindow(id, point, target && { label: target.label, point: target.point }));
    return false;
  }
}

let incomingPointer: { dragId: string; point: DesktopPoint } | undefined;
let incomingReorder: { dragId: string; move: (point: DesktopPoint) => void } | undefined;

function startWorkspaceStripReorder(id: string, point: DesktopPoint, grabRatio?: number) {
  const strip = Array.from(document.querySelectorAll<HTMLElement>('.workspace-instance-bar [data-reorder-list]')).find(
    (list) => !list.closest('[hidden], [inert]') && list.getBoundingClientRect().width > 0,
  );
  return strip && startHeldListReorder(strip, id, point, grabRatio);
}

export function updateWorkspaceDragPointer(point: DesktopPoint | null, dragId: string) {
  if (point) {
    incomingPointer = { dragId, point };
    if (incomingReorder?.dragId === dragId) incomingReorder.move(point);
  }
}

function reorderReceivedTab(id: string, placement: DesktopPoint, dragId?: string, grabRatio?: number) {
  let session: ReturnType<typeof startHeldListReorder>;
  let at = placement;
  let result: boolean | undefined;
  let frames = 0;
  const start = () => {
    if (result === false) return;
    session = startWorkspaceStripReorder(id, at, grabRatio);
    if (session && result === true) session.finish();
    if (!session && ++frames < 4) requestAnimationFrame(start);
  };
  if (dragId) {
    if (incomingPointer?.dragId === dragId) at = incomingPointer.point;
    incomingReorder = {
      dragId,
      move: (point) => {
        at = point;
        session?.move(point);
      },
    };
  }
  requestAnimationFrame(start);
  return (accepted: boolean) => {
    result = accepted;
    if (accepted) session?.finish();
    else session?.cancel();
    if (incomingReorder?.dragId === dragId) incomingReorder = undefined;
    if (incomingPointer?.dragId === dragId) incomingPointer = undefined;
  };
}

function prepareGroupWindowHandoff(
  groupTransfer: NonNullable<ReturnType<typeof parseGroupWindowHandoff>>,
  select: () => void,
): IncomingTabMove {
  const { group, tabs, color } = groupTransfer;
  if (findGroup(group.id)) throw unavailable();
  const previousColor = useWorkspaceNavigation.getState().groupColors[group.id];
  const transactions: IncomingTabMove[] = [];
  try {
    runWithoutWorkbenchSync(() => {
      for (const tab of tabs) transactions.push(prepareSingleWindowHandoff(tab));
    });
  } catch (error) {
    runWithoutWorkbenchSync(() => {
      for (const transaction of transactions) transaction.finish(false);
    });
    throw error;
  }
  let presented = false;
  const present = () => {
    if (presented) return;
    presented = true;
    runWithoutWorkbenchSync(() => {
      for (const transaction of transactions) transaction.present?.();
      const ids = new Set(tabs.map((tab) => tab.id));
      if (group.scope === 'terminal')
        useWorkspaceStore.setState((state) => ({
          tabs: state.tabs.map((tab) => (ids.has(tab.id) && isSessionTab(tab) ? { ...tab, groupId: group.id } : tab)),
          groups: [...state.groups, { id: group.id, title: group.title, collapsed: group.collapsed }],
        }));
      useWorkbenchStore.getState().update((state) => ({
        ...state,
        groups: [...state.groups, group],
        tabs: state.tabs.map((tab) => (ids.has(tab.id) ? { ...tab, groupId: group.id } : tab)),
      }));
      if (color) useWorkspaceNavigation.getState().setGroupColor(group.id, color);
    });
    select();
  };
  return {
    ready: Promise.all(transactions.map((transaction) => transaction.ready)).then(() => undefined),
    present,
    finish: (accepted) => {
      if (accepted) present();
      runWithoutWorkbenchSync(() => {
        for (const transaction of transactions) transaction.finish(accepted);
      });
      if (!accepted && presented) {
        useWorkspaceStore.setState((state) => ({ groups: state.groups.filter((item) => item.id !== group.id) }));
        useWorkbenchStore.getState().update((state) => ({ ...state, groups: state.groups.filter((item) => item.id !== group.id) }));
        useWorkspaceNavigation.getState().setGroupColor(group.id, previousColor ?? null);
      }
    },
  };
}

export function prepareWindowHandoff(value: unknown, placement?: DesktopPoint, dragId?: string, grabRatio?: number): IncomingTabMove {
  const group = parseGroupWindowHandoff(value);
  const received = group ? null : parseWindowHandoff(value);
  if (!group && !received) throw new Error(t('The new window could not receive this tab.'));
  const activeId = group ? (group.selected ?? group.tabs[0]!.id) : received!.id;
  const draggedId = group?.group.id ?? activeId;
  const scope = group?.group.scope ?? received!.scope;
  const previousArea = useWorkspaceNavigation.getState().area;
  const previousActive = useWorkspaceStore.getState().activeId;
  const previousTabs = useWorkbenchStore.getState().snapshot.selected;
  const select = () => activateContainer(activeId, !dragId && !useWorkspaceWindowStaging.getState().staged);
  const transfer = group ? prepareGroupWindowHandoff(group, select) : prepareSingleWindowHandoff(received!, select);
  let reorder: ReturnType<typeof reorderReceivedTab> | undefined;
  return {
    ready: transfer.ready,
    present: () => {
      transfer.present?.();
      if (placement && dragId) reorder = reorderReceivedTab(draggedId, placement, dragId, grabRatio);
    },
    tabBounds: () => {
      const row = Array.from(document.querySelectorAll<HTMLElement>('.workspace-instance-bar [data-reorder-item]')).find(
        (item) => item.dataset.reorderItem === draggedId && item.getBoundingClientRect().width > 0,
      );
      const bounds = row?.getBoundingClientRect();
      if (bounds) return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    },
    finish: (accepted) => {
      if (!accepted) reorder?.(false);
      transfer.finish(accepted);
      if (accepted && placement) (reorder ?? reorderReceivedTab(draggedId, placement, dragId, grabRatio))(true);
      if (!accepted && dragId) {
        const priorTab = previousTabs[scope];
        if (scope !== previousArea && priorTab && findTab(priorTab)) activateContainer(priorTab, false);
        const id = previousTabs[previousArea as WorkspaceContainer['scope']];
        if (id && findTab(id)) activateContainer(id, false);
        else if (useWorkspaceStore.getState().tabs.some((tab) => tab.id === previousActive))
          useWorkspaceStore.getState().activate(previousActive);
        useWorkspaceNavigation.getState().selectArea(previousArea);
      }
    },
  };
}

function prepareSingleWindowHandoff(received: TabWindowHandoff, select?: () => void): IncomingTabMove {
  const workspace = useWorkspaceStore.getState();
  const workbench = useWorkbenchStore.getState();
  if (findTab(received.id) || workspace.tabs.some((tab) => tab.id === received.id)) throw unavailable();
  if (received.scope === 'terminal') {
    const { id, layout, title, titleSource, terminals, focused, draftTimestamp } = received;
    if (terminals.some((pane) => currentWorkspaceResources().some((resource) => resource.id === `terminal:${pane.paneId}`)))
      throw unavailable();
    const ready = stageTerminalHandoffs(terminals);
    for (const pane of terminals) {
      useBlockStore.getState().setBlocks(
        pane.paneId,
        pane.blocks.map((block) => ({ ...block, outputHtml: sanitizeOutputHtml(block.outputHtml) })),
      );
    }
    useInputStore.setState((state) => ({
      byPane: { ...state.byPane, ...Object.fromEntries(terminals.flatMap((pane) => (pane.draft ? [[pane.paneId, pane.draft]] : []))) },
    }));
    const tab: Tab = { kind: 'session', id, title, titleSource, layout };
    useWorkspaceStore.setState((state) => ({
      tabs: [...state.tabs, tab],
      terminalCwds: {
        ...state.terminalCwds,
        ...Object.fromEntries(terminals.flatMap((pane) => (pane.cwd ? [[pane.paneId, pane.cwd]] : []))),
      },
    }));
    useWorkbenchStore.setState({ ready: true });
    synchronizeWorkbench();
    const present = () => {
      select?.();
      if (select) useTerminalStore.getState().setFocusedPane(focused);
    };
    return {
      ready: ready.then(() => undefined),
      present,
      finish: (accepted) => {
        discardTerminalHandoffs(terminals);
        if (accepted) {
          if (draftTimestamp !== undefined)
            void createSessionDraft(id, title, terminals[0]?.cwd, 'session', JSON.stringify({ layout }), draftTimestamp);
          present();
        } else {
          forgetSessionDraft(id);
          workspace.closeTab(id, true, 'move');
          synchronizeWorkbench();
        }
      },
    };
  }
  const { documents, id, scope, title, layout, focused, terminals = [], conversations = [], agents = [], comparisons = [] } = received;
  const ids = new Set(panesOf({ id, scope, layout, focused }).map((pane) => pane.resourceId));
  const existing = currentWorkspaceResources().find((resource) => ids.has(resource.id));
  if (existing?.kind === 'document') throw new Error(t('A file in this tab is already open in the destination window.'));
  const diffKeys = new Set(comparisons.map((item) => gitComparisonKey(item.selection)));
  if (existing || comparisonsIn(workspace.tabs).some((item) => diffKeys.has(gitComparisonKey(item.selection)))) throw unavailable();
  const staged: IncomingTabMove[] = [];
  try {
    for (const terminal of terminals) staged.push(prepareSingleWindowHandoff(terminal));
  } catch (error) {
    for (const transaction of staged) transaction.finish(false);
    throw error;
  }
  let presented = false;
  const agentIds = agents.map((item) => item.id);
  const conversationIds = new Set(conversations.map((item) => item.id));
  const documentKeys = documents.map((item) => editorFileKey(item.file));
  const documentCache = useEditorDocuments.getState().documents;
  const composerCache = useComposerDrafts.getState().byTab;
  const existingConversations = useChatStore.getState().conversations.filter((item) => conversationIds.has(item.id));
  const present = () => {
    if (presented) return;
    presented = true;
    if (agentIds.length) useWorkspaceWindowStaging.setState((state) => ({ agents: new Set([...state.agents, ...agentIds]) }));
    runWithoutWorkbenchSync(() => {
      const previous = useWorkspaceNavigation.getState().area;
      useEditorDocuments.setState((state) => ({
        documents: {
          ...state.documents,
          ...Object.fromEntries(
            documents.map((item) => [editorFileKey(item.file), { ...item, request: 0, loading: false, saving: false }]),
          ),
        },
      }));
      for (const item of documents) workspace.openEditorFile(item.file);
      if (comparisons.length)
        useWorkspaceStore.setState((state) => ({
          tabs: [
            ...state.tabs,
            ...comparisons.map((item) => ({
              kind: 'git-diff' as const,
              id: item.id,
              title: item.selection.path,
              selection: item.selection,
            })),
          ],
        }));
      if (conversations.length) {
        useChatStore.setState((state) => ({
          conversations: [
            ...state.conversations.filter((item) => !conversationIds.has(item.id)),
            ...conversations.map(({ draft: _draft, ...item }) => item),
          ],
        }));
        for (const item of conversations) useAiWorkspace.getState().ensureNative(item.id);
      }
      if (agents.length)
        useHarnessWorkspace.setState((state) => ({
          connections: [...state.connections, ...agents.map(({ draft: _draft, ...item }) => ({ ...item, fresh: !item.resumeSessionId }))],
        }));
      for (const item of [...conversations, ...agents]) {
        if (item.draft) useComposerDrafts.setState((state) => ({ byTab: { ...state.byTab, [item.id]: item.draft! } }));
      }
      useWorkspaceStore.setState({ activeId: workspace.activeId });
      useWorkspaceNavigation.getState().selectArea(previous);
      workbench.update((state) => putContainer(releaseContainerResources(state, scope, ids, id), { id, scope, title, layout, focused }));
      useWorkbenchStore.setState({ ready: true });
    });
    select?.();
  };
  return {
    ready: Promise.all(staged.map((transaction) => transaction.ready)).then(() => undefined),
    present,
    finish: (accepted) => {
      if (accepted) present();
      runWithoutWorkbenchSync(() => {
        for (const transaction of staged) transaction.finish(accepted);
        if (accepted || !presented) return;
        for (const item of documents) workspace.closeEditorFile(item.file, true);
        for (const item of comparisons) workspace.closeGitComparison(item.id);
        for (const item of conversations) useAiWorkspace.getState().closeNative(item.id);
        useHarnessWorkspace.getState().close(agentIds);
        if (conversations.length)
          useChatStore.setState((state) => ({
            conversations: [...state.conversations.filter((item) => !conversationIds.has(item.id)), ...existingConversations],
          }));
        if (documentKeys.length)
          useEditorDocuments.setState((state) => {
            const documents = { ...state.documents };
            for (const key of documentKeys) {
              const previous = documentCache[key];
              if (previous) documents[key] = previous;
              else delete documents[key];
            }
            return { documents };
          });
        if (conversations.length || agentIds.length)
          useComposerDrafts.setState((state) => {
            const byTab = { ...state.byTab };
            for (const id of [...conversationIds, ...agentIds]) {
              const previous = composerCache[id];
              if (previous) byTab[id] = previous;
              else delete byTab[id];
            }
            return { byTab };
          });
        workbench.update((state) => removeContainers(state, new Set([id])));
        useWorkspaceStore.setState({ lastClosed: workspace.lastClosed });
      });
      if (agentIds.length)
        useWorkspaceWindowStaging.setState((state) => ({ agents: new Set([...state.agents].filter((id) => !agentIds.includes(id))) }));
    },
  };
}
