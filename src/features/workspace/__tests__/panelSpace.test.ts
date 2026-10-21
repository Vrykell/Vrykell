import { afterEach, beforeEach, expect, it } from 'vitest';
import { useDockStore } from '../stores/dock';
import { useWorkspaceNavigation } from '../stores/navigation';

const originalWidth = window.innerWidth;
const snapshot = useDockStore.getState();
beforeEach(() => {
  useWorkspaceNavigation.setState({ collapsed: false, area: 'code' });
  useDockStore.setState({ leftZone: [], rightZone: ['files', 'chat'], leftPanels: [], rightPanels: [], panelWidths: {}, collapsedPanels: [] });
});
afterEach(() => { Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth }); useDockStore.setState(snapshot, true); });

it.each([1240, 940, 908, 760, 600])('keeps a usable right panel at width %s', width => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  useWorkspaceNavigation.setState({ collapsed: width <= 900 });
  useDockStore.getState().openPanel('chat');
  expect(useDockStore.getState().rightPanels).toEqual(['chat']);
  expect(useDockStore.getState().leftPanels).toEqual([]);
});
it('closes the panel when neither the rail nor a usable terminal can fit', () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 560 });
  useDockStore.getState().openPanel('chat');
  expect(useDockStore.getState().rightPanels).toEqual([]);
});
it('reconciles a shrinking window without opening another panel', () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1240 });
  useDockStore.getState().openPanel('chat');
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 760 });
  useDockStore.getState().reconcilePanelSpace();
  expect(useDockStore.getState().rightPanels).toEqual(['chat']);
});
