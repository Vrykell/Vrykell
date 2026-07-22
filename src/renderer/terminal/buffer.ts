export interface Cell { char: string; fg?: string; bg?: string; bold?: boolean; italic?: boolean; underline?: boolean; /** true when this cell is the second half of a fullwidth character */ wide?: boolean; }
export interface TerminalLine { cells: Cell[]; dirty: boolean; }

const FG: Record<number,string>={30:'#000',31:'#cd3131',32:'#0dbc79',33:'#e5e510',34:'#2472c8',35:'#bc3fbc',36:'#11a8cd',37:'#e5e5e5',90:'#666',91:'#f14c4c',92:'#23d18b',93:'#f5f543',94:'#3b8eea',95:'#d670d6',96:'#29b8db',97:'#fff'};
const BG: Record<number,string>={40:'#000',41:'#cd3131',42:'#0dbc79',43:'#e5e510',44:'#2472c8',45:'#bc3fbc',46:'#11a8cd',47:'#e5e5e5'};

/** Return the display width of a code-point (1 or 2).  Based on Unicode East Asian Width. */
function charWidth(code: number): number {
  if (code < 0x20) return 0;              // control
  if (code < 0x7f) return 1;              // ASCII
  if (code < 0xa0) return 0;              // C1
  // Wide CJK ranges (subset covering the most common scripts)
  if (code >= 0x1100 && code <= 0x115f) return 2;  // Hangul Jamo
  if (code >= 0x2329 && code <= 0x232a) return 2;  // Misc Technical
  if (code >= 0x2e80 && code <= 0x303e) return 2;  // CJK Radicals / Kangxi / Ideographic Desc / CJK Symbols / Kana iter marks / Bopomofo / Hangul Compat Jamo / Kanbun / Bopomofo Ext
  if (code >= 0x3040 && code <= 0x33bf) return 2;  // Hiragana / Katakana / Bopomofo / Hangul Compat / CJK Misc / Enclosed CJK / CJK Compat / Yi / Hangul Syllables
  if (code >= 0x3400 && code <= 0x4dbf) return 2;  // CJK Unified Ideographs Ext A
  if (code >= 0x4e00 && code <= 0xa4cf) return 2;  // CJK Unified Ideographs / Yi
  if (code >= 0xa960 && code <= 0xa97f) return 2;  // Hangul Jamo Extended-A
  if (code >= 0xac00 && code <= 0xd7a3) return 2;  // Hangul Syllables
  if (code >= 0xf900 && code <= 0xfaff) return 2;  // CJK Compatibility Ideographs
  if (code >= 0xfe10 && code <= 0xfe19) return 2;  // Vertical forms
  if (code >= 0xfe30 && code <= 0xfe6f) return 2;  // CJK Compatibility Forms / Small Form Variants
  if (code >= 0xff01 && code <= 0xff60) return 2;  // Fullwidth Forms
  if (code >= 0xffe0 && code <= 0xffe6) return 2;  // Fullwidth Signs
  if (code >= 0x1f300 && code <= 0x1f64f) return 2; // Emoticons / Misc Symbols
  if (code >= 0x1f680 && code <= 0x1f6ff) return 2; // Transport / Map Symbols
  if (code >= 0x1f900 && code <= 0x1f9ff) return 2; // Supplemental Symbols
  if (code >= 0x20000 && code <= 0x2ffff) return 2; // CJK Ext B+
  if (code >= 0x30000 && code <= 0x3ffff) return 2; // CJK Ext G+
  return 1;
}

/** Convert an xterm 256-color index to a hex colour string. */
function xterm256ToHex(n: number): string {
  if (n < 16) {
    const code = n < 8 ? 30 + n : 90 + (n - 8);
    return FG[code]!;
  }
  if (n < 232) {
    // 6x6x6 RGB cube
    const idx = n - 16;
    const r = Math.floor(idx / 36);
    const g = Math.floor((idx % 36) / 6);
    const b = idx % 6;
    const toHex = (v: number) => (v === 0 ? '00' : (v * 40 + 55).toString(16).padStart(2, '0'));
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }
  // Grayscale ramp (232-255)
  const L = (n - 232) * 10 + 8;
  const h = L.toString(16).padStart(2, '0');
  return `#${h}${h}${h}`;
}

export class TerminalBuffer {
  lines: TerminalLine[] = [{ cells: [], dirty: false }];
  cx = 0; cy = 0; cols = 80; rows = 24; version = 0;
  private fg?: string; private bg?: string; private bold=false; private italic=false; private underline=false;
  private savedCx=0; private savedCy=0;
  // Buffer for partial escape sequences that span across PTY read chunks.
  // When a CSI/OSC/DCS/ESC sequence is split mid-sequence, we save the
  // incomplete prefix here and prepend it to the next write() call.
  // Fixes: leaked characters (like '%') from split OSC title sequences.
  private pending = '';

  write(data: string): void {
    // Prepend any partial sequence from the previous chunk
    data = this.pending + data;
    this.pending = '';

    let i = 0;
    while (i < data.length) {
      const c = data.charCodeAt(i);

      // ESC sequence — consume full sequence
      if (c === 0x1b && i + 1 < data.length) {
        const start = i; i++;
        const next = data[i];
        if (next === '[') { // CSI — params/intermediates then final byte 0x40–0x7E
          i++;
          let complete = false;
          while (i < data.length) {
            const fc = data.charCodeAt(i);
            if (fc >= 0x40 && fc <= 0x7e) { this.csi(data.slice(start, i + 1)); i++; complete = true; break; }
            i++;
          }
          // If we never found a final byte, this CSI is split across chunks
          if (!complete) { this.pending = data.slice(start); return; }
          continue;
        } else if (next === ']') { // OSC — terminated by BEL or ST (ESC \)
          i++;
          while (i < data.length && data.charCodeAt(i) !== 0x07 && data[i] !== '\x1b') i++;
          if (i >= data.length) {
            // OSC not terminated — save for next chunk
            this.pending = data.slice(start);
            return;
          }
          if (data.charCodeAt(i) === 0x07) { i++; }          // BEL — skip it
          else if (data[i] === '\x1b') {
            if (i + 1 >= data.length) {
              // ESC at end of chunk — might be start of ST, save for next chunk
              this.pending = data.slice(start);
              return;
            }
            if (data[i + 1] === '\\') { i += 2; }            // ST — skip ESC \
            // else: ESC ends the OSC AND starts the next escape sequence —
            // leave i pointing at the ESC so the main loop re-parses it.
          }
          continue;
        } else if (next === 'P' || next === 'X' || next === '^' || next === '_') { // DCS/SOS/PM/APC — skip to ST (ESC \)
          i++;
          let complete = false;
          while (i < data.length) {
            if (data[i] === '\x1b' && i + 1 < data.length && data[i + 1] === '\\') { i += 2; complete = true; break; }
            i++;
          }
          if (!complete) { this.pending = data.slice(start); return; }
          continue;
        } else { i++; } // simple ESC (e.g. ESC Z, ESC c)
        continue;
      }

      // Lone ESC at end of chunk — save for next chunk
      if (c === 0x1b) { this.pending = data.slice(i); return; }

      // Control chars — all cursor movement cancels a pending wrap
      if (c === 0x0d) { this.cx = 0; this.pendingWrap = false; i++; continue; }
      if (c === 0x0a) { this.pendingWrap = false; this.lf(); i++; continue; }
      if (c === 0x08) { this.pendingWrap = false; if (this.cx > 0) this.cx--; i++; continue; }
      if (c === 0x09) { this.pendingWrap = false; this.cx = Math.min(this.cols-1, (Math.floor(this.cx/8)+1)*8); i++; continue; }
      if (c < 0x20) { i++; continue; }

      // Printable character
      this.putChar(data[i]); i++;
    }
    this.version++;
  }

  // ═══ CSI ═════════════════════════════════════════

  private csi(seq: string): void {
    const f = seq.charCodeAt(seq.length - 1);        // final byte
    const body = seq.slice(2, -1);                     // between ESC[ and final
    const isPrivate = body.startsWith('?');
    const clean = isPrivate ? body.slice(1) : body;
    const p = clean ? clean.split(';').map(v => parseInt(v) || 0) : [];

    // DEC private modes — set/reset
    if (isPrivate) {
      if (f === 0x68) { for (const n of p) { if (n===25) this.cursorVisible=true; if (n===1049) {} if (n===7) this.autoWrap=true; } } // h
      if (f === 0x6c) { for (const n of p) { if (n===25) this.cursorVisible=false; if (n===1049) {} if (n===7) { this.autoWrap=false; this.pendingWrap=false; } } } // l
      return;
    }

    // Cursor-moving CSI cancels a pending wrap (SGR/ED/EL do not)
    switch (f) {
      case 0x6d: this.sgr(p); break;                                    // m SGR
      case 0x41: this.cy = Math.max(0, this.cy - (p[0]||1)); this.pendingWrap=false; break;    // A up
      case 0x42: this.cy = Math.min(9999, this.cy + (p[0]||1)); this.pendingWrap=false; break; // B down
      case 0x43: this.cx = Math.min(this.cols-1, this.cx + (p[0]||1)); this.pendingWrap=false; break; // C right
      case 0x44: this.cx = Math.max(0, this.cx - (p[0]||1)); this.pendingWrap=false; break;    // D left
      case 0x48: this.cy = Math.max(0,(p[0]||1)-1); this.cx=(p[1]||1)-1; this.pendingWrap=false; break; // H CUP
      case 0x4a: // J ED
        if ((p[0]||0) === 2) { this.lines = [{ cells: [], dirty: false }]; this.cx=0; this.cy=0; }
        else if ((p[0]||0) === 0) {
          // Erase from cursor to end: clear current line from cx, clear all lines below
          const ln = this.line(); ln.cells = ln.cells.slice(0, this.cx); ln.dirty = true;
          for (let y = this.cy + 1; y < this.lines.length; y++) { this.lines[y].cells = []; this.lines[y].dirty = true; }
        }
        break;
      case 0x4b: { // K EL
        const ln = this.line();
        if ((p[0]||0) === 0) ln.cells = ln.cells.slice(0, this.cx);
        else if ((p[0]||0) === 2) ln.cells = [];
        ln.dirty = true;
        break;
      }
      case 0x73: this.savedCx=this.cx; this.savedCy=this.cy; break;    // s save
      case 0x75: this.cx=this.savedCx; this.cy=this.savedCy; this.pendingWrap=false; break;    // u restore
      case 0x64: this.cy = (p[0]||1)-1; this.pendingWrap=false; break;                          // d VPA
      case 0x47: this.cx = (p[0]||1)-1; this.pendingWrap=false; break;                          // G CHA
    }
  }

  // ═══ SGR ═════════════════════════════════════════

  private sgr(p: number[]): void {
    if (p.length === 0 || (p.length === 1 && p[0] === 0)) { this.fg=undefined; this.bg=undefined; this.bold=false; this.italic=false; this.underline=false; return; }
    for (let i = 0; i < p.length; i++) {
      const v = p[i];
      if (v === 0) { this.fg=undefined; this.bg=undefined; this.bold=false; this.italic=false; this.underline=false; }
      else if (v === 1) this.bold = true;
      else if (v === 3) this.italic = true;
      else if (v === 4) this.underline = true;
      else if (v === 22) this.bold = false;
      else if (v === 23) this.italic = false;
      else if (v === 24) this.underline = false;
      else if (v === 39) this.fg = undefined;
      else if (v === 49) this.bg = undefined;
      else if (v === 38) {
        // Extended foreground: 38;5;N (256-color) or 38;2;R;G;B (truecolor)
        if (i + 2 < p.length) {
          if (p[i + 1] === 5) { this.fg = xterm256ToHex(p[i + 2]); i += 2; }
          else if (p[i + 1] === 2 && i + 4 < p.length) { this.fg = `#${p[i+2].toString(16).padStart(2,'0')}${p[i+3].toString(16).padStart(2,'0')}${p[i+4].toString(16).padStart(2,'0')}`; i += 4; }
          else { i += 2; } // skip unrecognized sub-params
        }
      }
      else if (v === 48) {
        // Extended background: 48;5;N (256-color) or 48;2;R;G;B (truecolor)
        if (i + 2 < p.length) {
          if (p[i + 1] === 5) { this.bg = xterm256ToHex(p[i + 2]); i += 2; }
          else if (p[i + 1] === 2 && i + 4 < p.length) { this.bg = `#${p[i+2].toString(16).padStart(2,'0')}${p[i+3].toString(16).padStart(2,'0')}${p[i+4].toString(16).padStart(2,'0')}`; i += 4; }
          else { i += 2; }
        }
      }
      else if (FG[v]) this.fg = FG[v];
      else if (BG[v]) this.bg = BG[v];
    }
  }

  // ═══ Character output ═════════════════════════════

  // Deferred-wrap (pending-wrap) semantics, like xterm's automatic margins:
  // writing a character into the last column does NOT immediately wrap.
  // The cursor stays on the last column with pendingWrap set; the wrap only
  // happens when the NEXT printable character arrives. CR/LF/cursor movement
  // cancels the pending wrap. This is what zsh's PROMPT_SP relies on to
  // erase its '%' EOL marker by overwriting it with the prompt.
  private pendingWrap = false;
  private autoWrap = true;  // DECAWM (?7), default on

  private putChar(ch: string): void {
    const w = charWidth(ch.codePointAt(0) ?? 0);
    if (w === 0) return;         // control char — shouldn't reach here
    if (w === 2 && this.cx >= this.cols - 1) { this.cx = 0; this.lf(); } // won't fit → wrap

    if (this.pendingWrap) { this.cx = 0; this.lf(); this.pendingWrap = false; }

    const ln = this.line();
    while (ln.cells.length <= this.cx + w - 1) ln.cells.push({ char: ' ' });

    ln.cells[this.cx] = { char: ch, fg: this.fg, bg: this.bg, bold: this.bold, italic: this.italic, underline: this.underline };
    ln.dirty = true;
    if (w === 2) ln.cells[this.cx + 1] = { char: '', wide: true, fg: this.fg, bg: this.bg };

    if (this.cx + w >= this.cols) {
      if (this.autoWrap) this.pendingWrap = true;
      this.cx = this.cols - 1;  // stay on last column (deferred-wrap)
    } else {
      this.cx += w;
    }
  }

  private line(): TerminalLine {
    while (this.lines.length <= this.cy) this.lines.push({ cells: [], dirty: false });
    return this.lines[this.cy];
  }

  private lf(): void { this.cy++; this.line(); }

  resize(cols: number): void { if (cols > 10) { this.cols = cols; this.pendingWrap = false; } }
  clear(): void { this.lines = [{ cells: [], dirty: false }]; this.cx=0; this.cy=0; this.pendingWrap=false; this.version++; }
  cursorVisible = true;
}
