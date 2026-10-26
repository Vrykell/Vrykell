import { expect, it } from 'vitest';
import { TAB_KIND_AREA, workspaceAreaForKind } from '../model/tabArea';

it('routes every tab kind to exactly one functional workspace', () => {
  expect(TAB_KIND_AREA).toEqual({
    session: 'terminal',
    history: 'terminal',
    start: 'terminal',
    editor: 'code',
    'git-diff': 'code',
    'start-code': 'code',
    harness: 'ai',
    usage: 'ai',
    'ai-history': 'ai',
    'start-ai': 'ai',
    workspace: 'unified',
  });
  expect(Object.isFrozen(TAB_KIND_AREA)).toBe(true);
});

it('keeps an unknown persisted kind visible in the terminal instead of dropping it', () => {
  expect(workspaceAreaForKind('from-a-newer-build')).toBe('terminal');
  expect(workspaceAreaForKind('session')).toBe('terminal');
  expect(workspaceAreaForKind('workspace')).toBe('unified');
});
