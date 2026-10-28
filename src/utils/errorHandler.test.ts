/**
 * errorHandler — global error handling and safe parsing tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { installGlobalErrorHandlers, safeJsonParse, safeLocalStorageGet, safeLocalStorageSet } from '@utils/errorHandler';

describe('safeJsonParse / safeLocalStorage', () => {
  it('safeJsonParse with valid, invalid and empty input', () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
    expect(safeJsonParse('not json')).toBeNull();
    expect(safeJsonParse('')).toBeNull();
  });

  it('safeLocalStorage read/write with exception fallback', () => {
    expect(safeLocalStorageSet('k', 'v')).toBe(true);
    expect(safeLocalStorageGet('k')).toBe('v');
    // returns the default when localStorage throws (for example, when disabled)
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = vi.fn(() => { throw new Error('denied'); });
    expect(safeLocalStorageSet('k', 'v')).toBe(false);
    Storage.prototype.setItem = orig;
    const origGet = Storage.prototype.getItem;
    Storage.prototype.getItem = vi.fn(() => { throw new Error('denied'); });
    expect(safeLocalStorageGet('k')).toBeNull();
    Storage.prototype.getItem = origGet;
  });
});

describe('installGlobalErrorHandlers', () => {
  it('installing global error handlers does not throw; repeated installation is idempotent', () => {
    expect(() => installGlobalErrorHandlers()).not.toThrow();
    expect(() => installGlobalErrorHandlers()).not.toThrow();
  });

  it('both error events and unhandledrejection are listened to', () => {
    installGlobalErrorHandlers();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const win = window;
    // ErrorEvent (runtime error)
    const evt = new ErrorEvent('error', { message: 'boom', filename: 'a.js', lineno: 1, colno: 2 });
    win.dispatchEvent(evt);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
    // an error event that is not an ErrorEvent does not report
    win.dispatchEvent(new Event('error'));
    // promise rejection (jsdom may lack PromiseRejectionEvent; fall back to a plain Event)
    const rejEvt =
      typeof PromiseRejectionEvent !== 'undefined'
        ? new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason: new Error('nope') })
        : new Event('unhandledrejection');
    win.dispatchEvent(rejEvt);
    expect(errSpy).toHaveBeenCalledWith('[global] Unhandled Promise rejection:', expect.anything());
    errSpy.mockRestore();
  });
});
