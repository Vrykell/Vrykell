import type { DispatchEvent } from '@core/terminal/events';

/**
 * Test-only byte stream scanner — production scanning already happens on the Rust side
 * (src-tauri/src/scan.rs), so the frontend no longer owns a scanner; this keeps a
 * semantically equivalent implementation so SessionController tests can split raw
 * chunks (with embedded OSC/alt CSI) into a DispatchEvent list.
 */

const ESC = '\x1b';
const ALT_CODES = new Set(['1049', '1047', '47']);

/**
 * Alt-screen CSI direction: true = enter (h), false = exit (l), null = not alt.
 * Inspects every parameter so a mode combined with other DEC private modes
 * (e.g. `\x1b[?1049;2004h`) is still recognized.
 */
function altDirection(seq: string): boolean | null {
  if (!seq.startsWith(`${ESC}[?`)) return null;
  const body = seq.slice(3);
  const finalByte = body.slice(-1);
  if (finalByte !== 'h' && finalByte !== 'l') return null;
  if (!body.slice(0, -1).split(';').some(param => ALT_CODES.has(param))) return null;
  return finalByte === 'h';
}

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
        const alt = altDirection(seq);
        if (alt !== null) {
          flushData(i);
          events.push(alt ? { kind: 'altEnter', raw: seq } : { kind: 'altExit', raw: seq });
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
