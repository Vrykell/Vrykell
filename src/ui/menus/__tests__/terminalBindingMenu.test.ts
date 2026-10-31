import { describe, expect, it, vi } from 'vitest';
import { terminalBindingMenuItem } from '../terminalBindingMenu';

describe('terminalBindingMenuItem', () => {
  it('marks the follow action and lists live terminals as radio options', () => {
    const select = vi.fn();
    const item = terminalBindingMenuItem({
      value: null,
      options: [
        { id: 'pane-a', label: 'Build', description: 'Bash · /work', live: true },
        { id: 'pane-b', label: 'Server', live: false },
      ],
      onSelect: select,
    });

    expect(item.label).toBe('绑定终端');
    const submenu = item.submenu?.items ?? [];
    const follow = submenu.find(entry => entry.label === '跟随聚焦终端');
    expect(follow).toMatchObject({ checked: true });
    follow?.onClick?.();
    expect(select).toHaveBeenCalledWith(null);

    const live = submenu.find(entry => entry.label === 'Build');
    expect(live).toMatchObject({ checked: false, tip: 'Bash · /work' });
    live?.onClick?.();
    expect(select).toHaveBeenCalledWith('pane-a');
    expect(submenu.some(entry => entry.label === 'Server')).toBe(false);
  });

  it('checks the bound terminal and explains an empty terminal list', () => {
    const item = terminalBindingMenuItem({
      value: 'pane-a',
      options: [{ id: 'pane-a', label: 'Build', live: true }],
      onSelect: vi.fn(),
    });

    const submenu = item.submenu?.items ?? [];
    expect(submenu.find(entry => entry.label === 'Build')).toMatchObject({ checked: true });
    expect(submenu.find(entry => entry.label === '跟随聚焦终端')).toMatchObject({ checked: false });
    expect(terminalBindingMenuItem({ value: null, options: [], onSelect: vi.fn() }).submenu?.items)
      .toEqual([expect.objectContaining({ label: '跟随聚焦终端', checked: true }), expect.objectContaining({ label: '没有活跃的终端', disabled: true })]);
  });
});
