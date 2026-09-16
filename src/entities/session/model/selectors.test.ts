import { describe, expect, it } from 'vitest';
import { leaf } from '@/lib/windowLayout';
import { selectActiveSessionTab, selectSessionTabs } from '@/entities/session/model/selectors';

const session = { id: 'session', title: '终端', kind: 'session' as const, layout: leaf({ id: 'session#0', kind: 'local' }) };
const history = { id: 'history', title: '会话历史', kind: 'history' as const };

describe('session selectors', () => {
  it('只把当前真实会话标签作为 active session', () => {
    expect(selectActiveSessionTab({ tabs: [session, history], activeId: 'session' })).toEqual(session);
    expect(selectActiveSessionTab({ tabs: [session, history], activeId: 'history' })).toBeNull();
    expect(selectActiveSessionTab({ tabs: [session, history], activeId: 'missing' })).toBeNull();
  });

  it('过滤出所有真实会话标签', () => {
    expect(selectSessionTabs({ tabs: [session, history] })).toEqual([session]);
  });
});
