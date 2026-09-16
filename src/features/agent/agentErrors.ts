/**
 * agentErrors — AI SDK 错误拆解成人话。
 */

/**
 * 把 AI SDK 的错误拆成人话。v7 重试包装器（"Failed after 3 attempts"）会把
 * 底层的 APICallError（statusCode / responseBody / url / cause）整个吞掉，
 * 这里逐层展开：状态码 + 服务端响应体 + cause 链（Rust 代理的拒绝文案也在其中）。
 */
export function describeError(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  const seen = new Set<unknown>();
  while (cur != null && !seen.has(cur)) {
    seen.add(cur);
    if (cur instanceof Error) {
      const anyErr = cur as Error & {
        statusCode?: number;
        responseBody?: string;
        url?: string;
        cause?: unknown;
      };
      let line = cur.message || cur.name;
      if (typeof anyErr.statusCode === 'number') {
        line += ` [HTTP ${anyErr.statusCode}]`;
      }
      if (anyErr.url) line += ` (${anyErr.url})`;
      // 与上一层重复的消息不再追加
      if (!parts.some((p) => p.includes(line))) parts.push(line);
      if (typeof anyErr.responseBody === 'string' && anyErr.responseBody) {
        const body = anyErr.responseBody.slice(0, 300);
        if (!parts.some((p) => p.includes(body))) parts.push(`服务端响应: ${body}`);
      }
      cur = anyErr.cause;
    } else {
      const s = String(cur);
      if (!parts.some((p) => p.includes(s))) parts.push(s);

      break;
    }
  }
  return parts.filter(Boolean).join(' → ') || '未知错误';
}
