/**
 * errorHandler — 全局错误处理与安全解析测试。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  installGlobalErrorHandlers,
  safeJsonParse,
  safeLocalStorageGet,
  safeLocalStorageSet,
} from '@/services/tauri/errorHandler';

describe('safeJsonParse / safeLocalStorage', () => {
  it('safeJsonParse 合法/非法/空', () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
    expect(safeJsonParse('not json')).toBeNull();
    expect(safeJsonParse('')).toBeNull();
  });

  it('safeLocalStorage 读写与异常兜底', () => {
    expect(safeLocalStorageSet('k', 'v')).toBe(true);
    expect(safeLocalStorageGet('k')).toBe('v');
    // localStorage 抛错（如被禁用）时返回默认
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = vi.fn(() => {
      throw new Error('denied');
    });
    expect(safeLocalStorageSet('k', 'v')).toBe(false);
    Storage.prototype.setItem = orig;
    const origGet = Storage.prototype.getItem;
    Storage.prototype.getItem = vi.fn(() => {
      throw new Error('denied');
    });
    expect(safeLocalStorageGet('k')).toBeNull();
    Storage.prototype.getItem = origGet;
  });
});

describe('installGlobalErrorHandlers', () => {
  it('安装全局错误处理不抛异常；重复安装幂等', () => {
    expect(() => installGlobalErrorHandlers()).not.toThrow();
    expect(() => installGlobalErrorHandlers()).not.toThrow();
  });

  it('error 事件与 unhandledrejection 均被监听', () => {
    installGlobalErrorHandlers();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const win = window;
    // ErrorEvent（运行时错误）
    const evt = new ErrorEvent('error', { message: 'boom', filename: 'a.js', lineno: 1, colno: 2 });
    win.dispatchEvent(evt);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
    // 非 ErrorEvent 的 error 事件不报错
    win.dispatchEvent(new Event('error'));
    // Promise rejection（jsdom 可能缺 PromiseRejectionEvent，兜底用普通 Event）
    const rejEvt =
      typeof PromiseRejectionEvent !== 'undefined'
        ? new PromiseRejectionEvent('unhandledrejection', {
            promise: Promise.resolve(),
            reason: new Error('nope'),
          })
        : new Event('unhandledrejection');
    win.dispatchEvent(rejEvt);
    expect(errSpy).toHaveBeenCalledWith('[global] Unhandled Promise rejection:', expect.anything());
    errSpy.mockRestore();
  });
});
