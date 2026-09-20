import type { DispatchEvent } from '@core/terminal/events';

/**
 * 测试用字节流扫描器 —— 生产路径的扫描已在 Rust 端（src-tauri/src/scan.rs），
 * 前端不再持有扫描器；这里保留一份语义等价的实现，仅供 SessionController 测试
 * 把原始 chunk（内嵌 OSC/alt CSI）切成 DispatchEvent 列表。
 */

const ESC = '\x1b';
const ALT_RE = /^\x1b\[\?(1049|1047|47)([hl])$/;

export class ScanHelper {
  private pending = '';

  push(chunk: string): DispatchEvent[] {
    const s = this.pending + chunk;
    this.pending = '';
    const events: DispatchEvent[] = [];
    let textStart = 0;
    let i = 0;

    const flushData = (end: number) => {
      if (end > textStart) events.push({ kind: 'data', text: s.slice(textStart, end) });
    };

    while (i < s.length) {
      if (s[i] !== ESC) {
        i++;
        continue;
      }
      if (i + 1 >= s.length) break;
      const next = s[i + 1]!;

      if (next === ']') {
        const bel = s.indexOf('\x07', i + 2);
        const st = s.indexOf(ESC + '\\', i + 2);
        let end = -1;
        let termLen = 1;
        if (bel !== -1 && (st === -1 || bel < st)) {
          end = bel;
        } else if (st !== -1) {
          end = st;
          termLen = 2;
        }
        if (end === -1) break;
        const raw = s.slice(i, end + termLen);
        const body = s.slice(i + 2, end);
        const semi = body.indexOf(';');
        let code: string;
        let payload: string;
        if (semi === -1) {
          code = body;
          payload = '';
        } else {
          const num = body.slice(0, semi);
          const rest = body.slice(semi + 1);
          if (num === '133') {
            const semi2 = rest.indexOf(';');
            code = semi2 === -1 ? `133;${rest}` : `133;${rest.slice(0, semi2)}`;
            payload = semi2 === -1 ? '' : rest.slice(semi2 + 1);
          } else {
            code = num;
            payload = rest;
          }
        }
        flushData(i);
        events.push({ kind: 'osc', code, payload, raw });
        i = end + termLen;
        textStart = i;
        continue;
      }

      if (next === '[') {
        let j = i + 2;
        while (j < s.length && /[0-9;?]/.test(s[j]!)) j++;
        if (j >= s.length) break;
        const seq = s.slice(i, j + 1);
        const m = ALT_RE.exec(seq);
        if (m) {
          flushData(i);
          events.push(m[2] === 'h' ? { kind: 'altEnter', raw: seq } : { kind: 'altExit', raw: seq });
          textStart = j + 1;
        }
        i = j + 1;
        continue;
      }

      i++;
    }

    if (i < s.length) {
      flushData(i);
      this.pending = s.slice(i);
    } else {
      flushData(s.length);
    }
    return events;
  }
}
