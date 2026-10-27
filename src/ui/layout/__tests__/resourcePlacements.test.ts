import { expect, it, vi } from 'vitest';
import { createResourcePlacements, type ResourcePlacement } from '../resourcePlacements';

const placement = (): ResourcePlacement => ({ target: document.createElement('div'), visible: true, focused: true });

it('notifies only the resource whose effective placement changes', () => {
  const registry = createResourcePlacements(); const first = vi.fn(); const other = vi.fn();
  const stop = registry.subscribe('one', first); registry.subscribe('other', other);
  const view = placement(); const release = registry.register('one', view);
  expect(registry.get('one')).toBe(view); expect(first).toHaveBeenCalledOnce(); expect(other).not.toHaveBeenCalled();
  const same = registry.register('one', { ...view }); expect(registry.get('one')).toBe(view); expect(first).toHaveBeenCalledOnce();
  same(); expect(first).toHaveBeenCalledOnce(); release(); release(); expect(first).toHaveBeenCalledTimes(2);
  expect(registry.get('one')).toBeUndefined(); stop(); registry.register('one', placement()); expect(first).toHaveBeenCalledTimes(2);
});

it('keeps remaining subscribers active when one subscriber leaves', () => {
  const registry = createResourcePlacements(); const first = vi.fn(); const second = vi.fn();
  const stopFirst = registry.subscribe('one', first); registry.subscribe('one', second);
  stopFirst(); registry.register('one', placement());
  expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledOnce();
});

it('restores an earlier visible owner when its replacement unmounts and ignores stale cleanups', () => {
  const registry = createResourcePlacements(); const original = placement(); const next = placement();
  const release = registry.register('one', original); const replace = registry.register('one', next);
  expect(registry.get('one')).toBe(next); replace(); expect(registry.get('one')).toBe(original);
  const newest = placement(); registry.register('one', newest); release(); expect(registry.get('one')).toBe(newest);
});

it('publishes focus, visibility and header ownership changes at a stable content target', () => {
  const registry = createResourcePlacements(); const changed = vi.fn(); const view = placement();
  registry.subscribe('one', changed); registry.register('one', view);
  for (const patch of [{ visible: false }, { focused: false }, { toolbarTarget: document.createElement('div') }, { retainHeader: true }]) registry.register('one', { ...view, ...patch });
  expect(changed).toHaveBeenCalledTimes(5);
});
