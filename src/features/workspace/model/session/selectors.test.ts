import { describe, expect, it } from 'vitest';
import { leaf } from '@features/workspace/model/windowLayout';
import { selectActiveSessionTab, selectSessionTabs } from '@features/workspace/model/session/selectors';

const session = { id: 'session', title: '终端', kind: 'session' as const, layout: leaf({ id: 'session#0', kind: 'local' }) };
const history = { id: 'history', title: '会话历史', kind: 'history' as const };

describe('session selectors', () => {
  it('treats only the current real session tab as the active session', () => {
    expect(selectActiveSessionTab({ tabs: [session, history], activeId: 'session' })).toEqual(session);
    expect(selectActiveSessionTab({ tabs: [session, history], activeId: 'history' })).toBeNull();
    expect(selectActiveSessionTab({ tabs: [session, history], activeId: 'missing' })).toBeNull();
  });

  it('selects every real session tab', () => {
    expect(selectSessionTabs({ tabs: [session, history] })).toEqual([session]);
  });
});
