/**
 * agentErrors — turn model SDK errors into plain language.
 */

/**
 * The v7 retry wrapper ("Failed after 3 attempts") swallows the underlying APICallError
 * (statusCode / responseBody / url / cause) entirely, so unwrap it layer by layer here: status
 * code + server response body + the cause chain (which also carries the backend proxy's rejection
 * text).
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
      // Do not append a message already contained in an earlier layer.
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
