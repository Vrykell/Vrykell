import { isValidElement, type ReactElement } from 'react';
import { expect, it } from 'vitest';
import { terminalTabHandle } from '../model/terminalTabHandle';
import type { Tab } from '../stores/workspace';

const session: Tab = {
  id: 'session', title: 'Project', kind: 'session',
  layout: { type: 'leaf', terminal: { id: 'session#0', kind: 'local', shellType: 'bash' } },
};

it('gives a session row the full terminal capabilities and a stable close target', () => {
  const handle = terminalTabHandle(session, 'Live title', 'zsh', 'tab-close-session');
  expect(handle).toMatchObject({
    id: 'session',
    label: 'Live title',
    tip: 'Live title',
    closeLabel: '关闭标签',
    closeTestId: 'tab-close-session',
    capabilities: { renameable: true, groupable: true },
  });
});

it('keeps singleton pages on the same strip without grouping or renaming', () => {
  const history = terminalTabHandle({ id: 'history', title: 'History', kind: 'history' }, 'History');
  expect(history).toMatchObject({
    label: 'History',
    capabilities: { renameable: false, groupable: false },
  });
  expect(history).not.toHaveProperty('closeTestId');
});

it('projects pages from the terminal strip without inferring area from the row', () => {
  const page = terminalTabHandle({ id: 'usage', title: 'Usage', kind: 'usage' }, 'Usage');
  expect(page).toMatchObject({ id: 'usage', label: 'Usage', capabilities: { groupable: false } });
});

it('fills an unspecified session shell from the machine default', () => {
  const restored: Tab = { id: 'restored', title: 'Restored', kind: 'session', layout: { type: 'leaf', terminal: { id: 'restored#0', kind: 'local' } } };
  const handle = terminalTabHandle(restored, 'Restored', 'zsh');
  const badge = handle.icon as ReactElement<{ children: ReactElement<{ shellType?: string }> }>;
  expect(isValidElement(badge)).toBe(true);
  expect(badge.props.children.props.shellType).toBe('zsh');
});
