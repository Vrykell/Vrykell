import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDockStore } from '@features/workspace/stores/dock';

describe('responsive panel space', () => {
  const originalWidth = window.innerWidth;
  const snapshot = useDockStore.getState();
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
    useDockStore.setState({ leftZone: ['tabs', 'ssh', 'files'], rightZone: ['chat'], leftPanels: ['tabs'], rightPanels: [], panelWidths: {}, collapsedPanels: [] });
  });
  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
    useDockStore.setState(snapshot, true);
  });

  it('replaces a navigation panel instead of opening both', () => {
    useDockStore.getState().openPanel('ssh');
    expect(useDockStore.getState().leftPanels).toEqual(['ssh']);
  });
  it('keeps both sides when command space remains usable', () => {
    useDockStore.getState().openPanel('chat');
    expect(useDockStore.getState().leftPanels).toEqual(['tabs']);
    expect(useDockStore.getState().rightPanels).toEqual(['chat']);
  });
  it('fits session navigation and the assistant at a compact desktop width', () => {
    Object.defineProperty(window, 'innerWidth', { value: 940 });
    useDockStore.getState().openPanel('chat');
    expect(useDockStore.getState().leftPanels).toEqual(['tabs']);
    expect(useDockStore.getState().rightPanels).toEqual(['chat']);
  });
  it('keeps the newly opened side in a narrow window', () => {
    Object.defineProperty(window, 'innerWidth', { value: 720 });
    useDockStore.getState().openPanel('chat');
    expect(useDockStore.getState().leftPanels).toEqual([]);
    expect(useDockStore.getState().rightPanels).toEqual(['chat']);
    useDockStore.getState().openPanel('tabs');
    expect(useDockStore.getState().rightPanels).toEqual([]);
    expect(useDockStore.getState().leftPanels).toEqual(['tabs']);
  });
  it('reconciles panels after resizing without hiding an open AI composer', () => {
    useDockStore.getState().openPanel('chat');
    Object.defineProperty(window, 'innerWidth', { value: 720 });
    useDockStore.getState().reconcilePanelSpace();
    expect(useDockStore.getState().rightPanels).toEqual(['chat']);
    expect(useDockStore.getState().leftPanels).toEqual([]);
  });
});
