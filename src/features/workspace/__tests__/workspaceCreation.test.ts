import { expect, it, vi } from 'vitest';
import { workspaceSplitMenu } from '../model/workspaceCreation';

it.each([
  ['terminal', ['terminal', 'ssh']], ['code', ['document', 'file']], ['ai', ['conversation', 'agent']],
  ['unified', ['terminal', 'ssh', 'conversation', 'document', 'file', 'agent']],
] as const)('keeps the %s split choices in one submenu and dispatches only the selected type', (scope, kinds) => {
  const pick = vi.fn(); const menu = workspaceSplitMenu(scope, pick);
  expect(menu.onClick).toBeUndefined();
  expect(menu.submenu!.items).toHaveLength(kinds.length);
  menu.submenu!.items.forEach((item, index) => { item.onClick!(); expect(pick).toHaveBeenLastCalledWith(kinds[index]); });
});
