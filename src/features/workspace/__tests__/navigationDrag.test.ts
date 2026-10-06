import { afterEach, describe, expect, it } from 'vitest';
import { useNavigationDrag } from '../stores/navigationDrag';

afterEach(() => useNavigationDrag.getState().end());

describe('navigation drag state', () => {
  it('shares the source across sides and changes insertion position without writing preferences', () => {
    const saved = localStorage.getItem('dock-layout-v4');
    useNavigationDrag.getState().start('files');
    useNavigationDrag.getState().hover('right', 0);
    expect(useNavigationDrag.getState().target).toEqual({ side: 'right', index: 0 });
    const same = useNavigationDrag.getState();
    useNavigationDrag.getState().hover('right', 0);
    expect(useNavigationDrag.getState()).toBe(same);
    useNavigationDrag.getState().hover('left', 2);
    expect(useNavigationDrag.getState().id).toBe('files');
    expect(useNavigationDrag.getState().target).toEqual({ side: 'left', index: 2 });
    expect(localStorage.getItem('dock-layout-v4')).toBe(saved);
  });
  it('clears all preview state on completion or cancellation and on the next drag', () => {
    useNavigationDrag.getState().start('tabs');
    useNavigationDrag.getState().hover('right', 1);
    useNavigationDrag.getState().movePointer(100, 24);
    expect(useNavigationDrag.getState().position).toEqual({ x: 100, y: 24 });
    useNavigationDrag.getState().end();
    expect(useNavigationDrag.getState().id).toBeNull();
    expect(useNavigationDrag.getState().target).toBeNull();
    expect(useNavigationDrag.getState().position).toBeNull();
    useNavigationDrag.getState().start('ssh');
    expect(useNavigationDrag.getState().id).toBe('ssh');
    expect(useNavigationDrag.getState().target).toBeNull();
  });
});
