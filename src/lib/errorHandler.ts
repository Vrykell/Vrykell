/**
 * 全局错误处理 — 捕获未被局部 try/catch 覆盖的异常。
 *
 * - window.onerror: 同步异常（语法错误、类型错误等）
 * - unhandledrejection: 未 catch 的 Promise rejection
 * - Tauri invoke 失败不会走到这里（每个 invoke 调用处自行处理）
 *
 * 设计原则：不静默吞掉错误，打印到 console 供调试，
 * 但不让应用白屏（白屏由 ErrorBoundary 兜底）。
 */

let installed = false;

export function installGlobalErrorHandlers() {
  if (installed) return;
  installed = true;

  window.addEventListener('error', (event) => {
    // 只处理运行时错误，跳过资源加载失败（如 <img src=404>）
    if (event instanceof ErrorEvent) {
      console.error(
        `[global] ${event.filename}:${event.lineno}:${event.colno} ${event.message}`,
      );
    }
    // 不调用 preventDefault()，让浏览器默认行为（控制台报错）继续
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error(
      '[global] Unhandled Promise rejection:',
      event.reason,
    );
    // 不调用 preventDefault()，让浏览器默认行为继续
  });
}

/**
 * 安全的 JSON 解析 — 不抛异常，返回 null + console.warn。
 * 用于 localStorage、IPC 消息等外部数据。
 */
export function safeJsonParse<T = unknown>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    console.warn('[safeJson] parse failed:', (e as Error).message, 'raw:', raw.slice(0, 120));
    return null;
  }
}

/**
 * 安全取 localStorage — 不抛异常（Safari 隐私模式、配额满等场景）。
 */
export function safeLocalStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    console.warn('[safeLs] getItem failed:', (e as Error).message);
    return null;
  }
}

export function safeLocalStorageSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    console.warn('[safeLs] setItem failed:', (e as Error).message);
    return false;
  }
}
