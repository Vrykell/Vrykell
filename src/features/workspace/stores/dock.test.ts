import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeDockLayout, useDockStore } from './dock';
import { useWorkspaceNavigation } from './navigation';

const snapshot = useDockStore.getState();
const originalWidth = window.innerWidth;
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1400 });
  useWorkspaceNavigation.setState({ collapsed: false, sidebarOverlay: false, area: 'code' });
  useDockStore.setState({ leftZone: [], rightZone: ['files', 'git', 'command-history', 'chat'], leftPanels: [], rightPanels: [], panelWidths: {}, collapsedPanels: [] });
});
afterEach(() => { useDockStore.setState(snapshot, true); Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth }); });

describe('right auxiliary dock', () => {
  it.each(['files', 'git', 'command-history', 'chat'])('opens %s on the right and replaces the previous panel', id => {
    useDockStore.getState().openPanel('files');
    useDockStore.getState().openPanel(id);
    expect(useDockStore.getState().rightPanels).toEqual([id]);
    expect(useDockStore.getState().leftPanels).toEqual([]);
    useDockStore.getState().togglePanel('left', id);
    expect(useDockStore.getState().rightPanels).toEqual([]);
  });
  it('ignores retired and unknown panels', () => {
    for (const id of ['tabs', 'ssh', 'missing']) { useDockStore.getState().openPanel(id); useDockStore.getState().togglePanel('left', id); }
    expect(useDockStore.getState().rightPanels).toEqual([]);
  });
  it('preserves visibility and persists ordering during a toolbar reorder', () => {
    useDockStore.getState().openPanel('chat');
    useDockStore.getState().moveButton('files', 'right', 3);
    expect(useDockStore.getState().rightZone).toEqual(['git', 'command-history', 'files', 'chat']);
    expect(useDockStore.getState().rightPanels).toEqual(['chat']);
    expect(JSON.parse(localStorage.getItem('dock-layout-v6')!).rightZone).toEqual(useDockStore.getState().rightZone);
  });
  it('moves an action to the independent left zone without opening a closed panel', () => {
    useDockStore.getState().moveButton('files', 'left');
    expect(useDockStore.getState().rightZone).toEqual(['git', 'command-history', 'chat']);
    expect(useDockStore.getState().leftZone).toEqual(['files']);
    expect(useDockStore.getState().leftPanels).toEqual([]);
  });
  it('does not reorder an unknown item or open a closed item during reordering', () => {
    const before = useDockStore.getState().rightZone;
    useDockStore.getState().moveButton('missing', 'right', 0);
    expect(useDockStore.getState().rightZone).toBe(before);
    useDockStore.getState().moveButton('chat', 'right', 0);
    expect(useDockStore.getState().rightPanels).toEqual([]);
  });
  it('keeps the mounted panel during resize collapse and restores it before release', () => {
    useDockStore.getState().openPanel('chat');
    useDockStore.getState().setPanelWidth('chat', -1000);
    expect(useDockStore.getState().rightPanels).toEqual(['chat']);
    expect(useDockStore.getState().collapsedPanels).toEqual(['chat']);
    expect(JSON.parse(localStorage.getItem('dock-layout-v6')!).rightPanels).toEqual([]);
    useDockStore.getState().setPanelWidth('chat', 100);
    useDockStore.getState().commitPanelWidth('chat');
    expect(useDockStore.getState().rightPanels).toEqual(['chat']);
    expect(useDockStore.getState().collapsedPanels).toEqual([]);
    expect(useDockStore.getState().panelWidths.chat).toBe(260);
  });
  it('closes a collapsed panel only on release and can reopen it at its retained width', () => {
    useDockStore.getState().openPanel('chat');
    useDockStore.getState().setPanelWidth('chat', -1000);
    useDockStore.getState().commitPanelWidth('chat');
    expect(useDockStore.getState().rightPanels).toEqual([]);
    useDockStore.getState().openPanel('chat');
    expect(useDockStore.getState().rightPanels).toEqual(['chat']);
    expect(useDockStore.getState().panelWidths.chat).toBe(160);
  });
  it('clamps resizing to the full-height sidebar and terminal budget', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1000 });
    useDockStore.getState().setPanelWidth('chat', 10000);
    expect(useDockStore.getState().panelWidths.chat).toBe(432);
  });
  it('ignores invalid resize requests', () => {
    useDockStore.getState().setPanelWidth('unknown', 100);
    useDockStore.getState().setPanelWidth('chat', Number.NaN);
    useDockStore.getState().setPanelWidth('chat', 0);
    expect(useDockStore.getState().panelWidths).toEqual({});
  });
  it('keeps the assistant in the side placement when opened through an older command', () => {
    useWorkspaceNavigation.setState({ aiPlacement: 'main' });
    useDockStore.getState().openPanel('chat');
    expect(useWorkspaceNavigation.getState().aiPlacement).toBe('side');
  });
  it('retains main AI placement when a narrow window cannot fit the auxiliary panel', () => {
    Object.defineProperty(window, 'innerWidth', { value: 560 });
    useWorkspaceNavigation.setState({ aiPlacement: 'main' });
    useDockStore.getState().openPanel('chat');
    expect(useDockStore.getState().rightPanels).toEqual([]);
    expect(useWorkspaceNavigation.getState().aiPlacement).toBe('main');
  });
});

describe('layout migration', () => {
  const seed = { leftZone: ['tabs', 'ssh', 'files', 'git'], rightZone: ['chat'], leftPanels: ['files'], rightPanels: [], panelWidths: { files: 240, chat: 350 } };
  it('moves saved auxiliary actions to the right and retires navigation panels', () => {
    expect(normalizeDockLayout(seed)).toEqual({ leftZone: [], rightZone: ['chat', 'files', 'git', 'command-history'], leftPanels: [], rightPanels: ['files'], panelWidths: { files: 200, chat: 320 } });
  });
  it('prefers the formerly visible right panel when two panels were open', () => {
    expect(normalizeDockLayout({ ...seed, rightPanels: ['chat'] })?.rightPanels).toEqual(['chat']);
  });
  it('preserves compact custom widths instead of applying the migration twice', () => {
    expect(normalizeDockLayout({ ...seed, widthPreset: 'compact' })?.panelWidths).toEqual({ files: 240, chat: 350 });
  });
  it('drops retired open panels without opening an unrelated auxiliary panel', () => {
    expect(normalizeDockLayout({ ...seed, leftPanels: ['tabs', 'ssh'] })?.rightPanels).toEqual([]);
  });
  it('repairs duplicate and unknown entries without discarding the saved order', () => {
    expect(normalizeDockLayout({ ...seed, rightZone: ['git', 'git', 'removed', 'settings'], leftZone: ['git', 'chat', 'files'] })?.rightZone).toEqual(['git', 'chat', 'files', 'command-history']);
  });
  it('sanitizes non-finite and obsolete widths', () => {
    expect(normalizeDockLayout({ ...seed, panelWidths: { files: 1, chat: Infinity, removed: 200 } })?.panelWidths).toEqual({ files: 160 });
  });
  it.each([null, [], {}, { ...seed, leftZone: null }, { ...seed, panelWidths: [] }])('rejects malformed layout %j', value => {
    expect(normalizeDockLayout(value)).toBeNull();
  });
  it('loads a previous storage version and writes the migrated layout separately', async () => {
    localStorage.setItem('dock-layout-v4', JSON.stringify(seed));
    vi.resetModules();
    const { useDockStore: migrated } = await import('./dock');
    expect(migrated.getState().leftZone).toEqual([]);
    expect(migrated.getState().rightPanels).toEqual(['files']);
    expect(localStorage.getItem('dock-layout-v4')).toBe(JSON.stringify(seed));
    expect(JSON.parse(localStorage.getItem('dock-layout-v6')!).rightPanels).toEqual(['files']);
  });
});

describe('independent auxiliary sides', () => {
  it('opens a remembered left panel as an overlay when the content leaves no sidebar budget', () => {
    Object.defineProperty(window, 'innerWidth', { value: 500 });
    const dock = useDockStore.getState();
    dock.moveButton('files', 'left'); dock.openPanel('files');
    expect(useWorkspaceNavigation.getState()).toMatchObject({ collapsed: false, sidebarOverlay: true });
    expect(useDockStore.getState().leftPanels).toEqual(['files']);
  });
  it('keeps one different panel on each side and closes either without affecting the other', () => {
    const dock = useDockStore.getState();
    dock.moveButton('files', 'left'); dock.openPanel('files'); dock.openPanel('chat');
    expect(useDockStore.getState()).toMatchObject({ leftPanels: ['files'], rightPanels: ['chat'] });
    dock.openPanel('git');
    expect(useDockStore.getState()).toMatchObject({ leftPanels: ['files'], rightPanels: ['git'] });
    dock.closePanel('files');
    expect(useDockStore.getState()).toMatchObject({ leftPanels: [], rightPanels: ['git'] });
  });
  it('keeps a single left panel and returns the displaced one to the right row', () => {
    const dock = useDockStore.getState();
    dock.moveButton('files', 'left'); dock.openPanel('files'); dock.openPanel('chat');
    dock.moveButton('chat', 'left');
    expect(useDockStore.getState()).toMatchObject({ leftZone: ['chat'], leftPanels: ['chat'], rightPanels: [] });
    // The displaced panel never disappears: it waits in the right button row and can be opened again.
    expect(useDockStore.getState().rightZone).toContain('files');
    dock.openPanel('files');
    expect(useDockStore.getState()).toMatchObject({ leftZone: ['chat'], leftPanels: ['chat'], rightPanels: ['files'] });
    dock.moveButton('chat', 'right', 0);
    expect(useDockStore.getState()).toMatchObject({ leftZone: [], leftPanels: [], rightPanels: ['chat'] });
    expect(useDockStore.getState().rightZone.filter(id => id === 'chat')).toHaveLength(1);
  });
  it('restores a collapsed left panel without replacing the right panel or its saved width', () => {
    const dock = useDockStore.getState();
    dock.moveButton('chat', 'left'); dock.openPanel('chat'); dock.openPanel('files');
    useWorkspaceNavigation.getState().setCollapsed(true);
    dock.reconcilePanelSpace();
    expect(useDockStore.getState()).toMatchObject({ leftPanels: ['chat'], rightPanels: ['files'] });
    dock.openPanel('chat');
    expect(useWorkspaceNavigation.getState().collapsed).toBe(false);
    expect(useDockStore.getState()).toMatchObject({ leftPanels: ['chat'], rightPanels: ['files'] });
  });
  it('normalizes and reloads both sides without rewriting the previous version', async () => {
    const seed = { layoutVersion: 6, widthPreset: 'compact', leftZone: ['files', 'files'], rightZone: ['files', 'chat'],
      leftPanels: ['files', 'chat'], rightPanels: ['files', 'chat'], panelWidths: { chat: 370 } };
    const expected = normalizeDockLayout(seed)!;
    expect(expected).toMatchObject({ leftZone: ['files'], leftPanels: ['files'], rightPanels: ['chat'], panelWidths: { chat: 370 } });
    expect(expected.rightZone).not.toContain('files');
    localStorage.setItem('dock-layout-v6', JSON.stringify(seed));
    localStorage.setItem('dock-layout-v5', 'previous layout');
    vi.resetModules();
    const { useDockStore: restored } = await import('./dock');
    expect(restored.getState()).toMatchObject(expected);
    expect(localStorage.getItem('dock-layout-v5')).toBe('previous layout');
  });
});
