import { expect, it, vi } from 'vitest';
import type { Tab } from '../stores/workspace';
import type { WorkspaceResource } from '../model/workspaceResources';
import { projectUnifiedTabs } from '../model/unifiedTabHandles';

type WorkspaceTab = Extract<Tab, { kind: 'workspace' }>;
const first: WorkspaceResource = { id: 'file:a', title: 'a.ts', kind: 'document', file: { path: '/repo/a.ts' } };
const second: WorkspaceResource = { id: 'file:b', title: 'b.ts', kind: 'document', file: { path: '/repo/b.ts' } };
const empty: WorkspaceTab = { id: 'empty', title: 'Start', kind: 'workspace', paneLayout: null, focusedPane: '' };
const composed: WorkspaceTab = {
  id: 'composed', title: 'Composed', kind: 'workspace', focusedPane: 'p1',
  paneLayout: { type: 'split', direction: 'row', ratio: 0.5, first: { type: 'pane', id: 'p1', resourceId: 'file:a' }, second: { type: 'pane', id: 'p2', resourceId: 'file:b' } },
};

it('aggregates live member titles until the page has a manual title', () => {
  const handles = projectUnifiedTabs([composed], [first, second], resource => <span data-resource={resource.id} />);
  expect(handles[0]).toMatchObject({
    id: 'composed', label: 'a.ts + b.ts', tip: 'a.ts + b.ts',
    capabilities: { renameable: true, groupable: false },
    dataAttributes: { 'data-tab-kind': 'workspace' },
  });
  const manual = projectUnifiedTabs([{ ...composed, title: 'Review', titleSource: 'manual' }], [first, second], () => null)[0]!;
  expect(manual.label).toBe('Review');
});

it('marks a dirty member without changing the page identity', () => {
  const handles = projectUnifiedTabs([composed], [{ ...first, dirty: true }, second], () => null);
  expect(handles[0]!.label).toBe('a.ts + b.ts •');
});

it('renders an empty composition as the non-renameable start canvas', () => {
  const icon = vi.fn(() => <span />);
  const [handle] = projectUnifiedTabs([empty], [first], icon);
  expect(handle).toMatchObject({
    label: '开始', tip: '开始', surface: 'canvas',
    capabilities: { renameable: false, groupable: false },
  });
  expect(icon).not.toHaveBeenCalled();
});

it('keeps page order and passes the first member to the shared icon renderer', () => {
  const icon = vi.fn((resource: WorkspaceResource) => <span data-resource={resource.id} />);
  const handles = projectUnifiedTabs([composed, empty], [first, second], icon);
  expect(handles.map(handle => handle.id)).toEqual(['composed', 'empty']);
  expect(icon).toHaveBeenCalledOnce();
  expect(icon).toHaveBeenCalledWith(first);
});
