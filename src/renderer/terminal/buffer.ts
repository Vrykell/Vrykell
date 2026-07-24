import type { TerminalEvent } from '../../shared/terminal-events';

export interface Cell { char: string; fg?: string; bg?: string; bold?: boolean; italic?: boolean; underline?: boolean; /** true when this cell is the second half of a fullwidth character */ wide?: boolean; }
export interface TerminalLine { cells: Cell[]; dirty: boolean; }

// ── Static color tables ──────────────────────────────────────────────────────

const FG: Record<number,string>={30:'#000',31:'#cd3131',32:'#0dbc79',33:'#e5e510',34:'#2472c8',35:'#bc3fbc',36:'#11a8cd',37:'#f0f0f0',90:'#888',91:'#f14c4c',92:'#23d18b',93:'#f5f543',94:'#3b8eea',95:'#d670d6',96:'#29b8db',97:'#fff'};
const BG: Record<number,string>={40:'#000',41:'#cd3131',42:'#0dbc79',43:'#e5e510',44:'#2472c8',45:'#bc3fbc',46:'#11a8cd',47:'#f0f0f0'};
const DEF_FG = '#f0f0f0';
const DEF_BG = '#000000';

// Pre-computed 256-color palette (computed once, cached for the process lifetime).
const X256: string[] = [];
{
  for (let n = 0; n < 256; n++) {
    if (n < 16) {
      X256[n] = FG[n < 8 ? 30 + n : 90 + (n - 8)]!;
    } else if (n < 232) {
      const idx = n - 16;
      const r = Math.floor(idx / 36), g = Math.floor((idx % 36) / 6), b = idx % 6;
      const t = (v: number) => (v === 0 ? '00' : (v * 40 + 55).toString(16).padStart(2, '0'));
      X256[n] = `#${t(r)}${t(g)}${t(b)}`;
    } else {
      const L = ((n - 232) * 10 + 8).toString(16).padStart(2, '0');
      X256[n] = `#${L}${L}${L}`;
    }
  }
}

// ── Char width ───────────────────────────────────────────────────────────────
// Widths follow string-width/wcwidth semantics so our column accounting
// matches what TUI frameworks (Ink, etc.) compute.  Two consequences of
// getting this wrong: zero-width modifiers (VS16, ZWJ) used to occupy a
// cell and render as "?" garbage, and emoji counted as 1 column vs the
// TUI's 2 shifted every subsequent cell on the line, producing phantom
// wrapped lines that the TUI's erase-lines repaint could never clear.
function charWidth(code: number): number {
  // ── Zero-width ─────────────────────────────────────────────────────────
  if (code < 0x20) return 0;                        // C0 controls
  if (code >= 0x7f && code < 0xa0) return 0;        // DEL + C1
  if (code >= 0x0300 && code <= 0x036f) return 0;   // combining diacriticals
  if (code >= 0x20d0 && code <= 0x20f0) return 0;   // combining marks for symbols
  if (code >= 0x200b && code <= 0x200f) return 0;   // ZWSP/ZWNJ/ZWJ/LRM/RLM
  if (code >= 0x202a && code <= 0x202e) return 0;   // bidi embedding/override
  if (code >= 0x2060 && code <= 0x2064) return 0;   // word joiner, invisible ops
  if (code === 0xfeff) return 0;                    // BOM / ZWNBSP
  if (code >= 0xfe00 && code <= 0xfe0f) return 0;   // variation selectors 1-16
  if (code >= 0xe0020 && code <= 0xe007f) return 0; // tag characters
  if (code >= 0xe0100 && code <= 0xe01ef) return 0; // variation selectors 17-256
  if (code < 0x1100) return 1;
  // ── Wide (2 columns) ───────────────────────────────────────────────────
  if (code <= 0x115f) return 2;                     // Hangul Jamo
  if (code >= 0x231a && code <= 0x231b) return 2;   // ⌚⌛
  if (code >= 0x2329 && code <= 0x232a) return 2;   // 〈〉
  if (code >= 0x23e9 && code <= 0x23ec) return 2;   // ⏩..⏬
  if (code === 0x23f0 || code === 0x23f3) return 2; // ⏰⏳
  if (code >= 0x23f8 && code <= 0x23fa) return 2;   // ⏸⏹⏺
  if (code === 0x25fd || code === 0x25fe) return 2; // ◽◾
  if (code === 0x2614 || code === 0x2615) return 2; // ☔☕
  if (code >= 0x2648 && code <= 0x2653) return 2;   // zodiac
  if (code === 0x267f) return 2;                    // ♿
  if (code === 0x2693) return 2;                    // ⚓
  if (code === 0x26a1) return 2;                    // ⚡
  if (code === 0x26aa || code === 0x26ab) return 2; // ⚪⚫
  if (code === 0x26bd || code === 0x26be) return 2; // ⚽⚾
  if (code === 0x26c4 || code === 0x26c5) return 2; // ⛄⛅
  if (code === 0x26ce) return 2;                    // ⛎
  if (code === 0x26d4) return 2;                    // ⛔
  if (code === 0x26ea) return 2;                    // ⛪
  if (code >= 0x26f2 && code <= 0x26f3) return 2;   // ⛲⛳
  if (code === 0x26f5) return 2;                    // ⛵
  if (code === 0x26fa) return 2;                    // ⛺
  if (code === 0x26fd) return 2;                    // ⛽
  if (code === 0x2705) return 2;                    // ✅
  if (code >= 0x270a && code <= 0x270b) return 2;   // ✊✋
  if (code === 0x2728) return 2;                    // ✨
  if (code === 0x274c) return 2;                    // ❌
  if (code === 0x274e) return 2;                    // ❎
  if (code >= 0x2753 && code <= 0x2755) return 2;   // ❓❔❕
  if (code === 0x2757) return 2;                    // ❗
  if (code >= 0x2795 && code <= 0x2797) return 2;   // ➕➖➗
  if (code === 0x27b0) return 2;                    // ➰
  if (code === 0x27bf) return 2;                    // ➿
  if (code === 0x2b1b || code === 0x2b1c) return 2; // ⬛⬜
  if (code === 0x2b50) return 2;                    // ⭐
  if (code === 0x2b55) return 2;                    // ⭕
  if (code >= 0x2e80 && code <= 0x303e) return 2;
  if (code >= 0x3040 && code <= 0x33bf) return 2;
  if (code >= 0x3400 && code <= 0x4dbf) return 2;
  if (code >= 0x4e00 && code <= 0xa4cf) return 2;
  if (code >= 0xa960 && code <= 0xa97f) return 2;
  if (code >= 0xac00 && code <= 0xd7a3) return 2;
  if (code >= 0xf900 && code <= 0xfaff) return 2;
  if (code >= 0xfe10 && code <= 0xfe19) return 2;
  if (code >= 0xfe30 && code <= 0xfe6f) return 2;
  if (code >= 0xff01 && code <= 0xff60) return 2;
  if (code >= 0xffe0 && code <= 0xffe6) return 2;
  if (code >= 0x1f000 && code <= 0x1faff) return 2; // all emoji blocks
  if (code >= 0x20000 && code <= 0x2ffff) return 2;
  if (code >= 0x30000 && code <= 0x3ffff) return 2;
  return 1;
}

// ── Inline CSI param parser (avoids string slicing + split allocation) ───────
// Reads semicolon-separated integer params from `data` starting at `pos`
// until the final byte `end`. Returns [params, nextPos].
function parseCsiParams(data: string, pos: number, end: number): [number[], number] {
  const p: number[] = [];
  let n = 0, hasDigit = false;
  while (pos < end) {
    const ch = data.charCodeAt(pos);
    if (ch >= 0x30 && ch <= 0x39) { n = n * 10 + (ch - 0x30); hasDigit = true; }
    else if (ch === 0x3b /* ; */) { p.push(n); n = 0; hasDigit = false; }
    pos++;
  }
  p.push(hasDigit ? n : 0);
  return [p, pos];
}

// ── Terminal buffer ──────────────────────────────────────────────────────────
//
// VT screen model: a fixed-height SCREEN (exactly `rows` lines) plus a
// capped SCROLLBACK above it.  The cursor is screen-relative (0..rows-1).
// LF on the bottom row scrolls: the top screen line moves into scrollback
// (main screen) or is discarded (the alternate screen has no scrollback).
//
// The previous model was a single ever-growing lines array with an absolute
// cursor — CUP addressed scrollback instead of the screen, and there was no
// bottom-edge scroll semantics, so any TUI using absolute positioning or
// scroll-based erasing desynced its line accounting from ours, which was
// the root cause of the recurring residual-artifact bugs.

export class TerminalBuffer {
  cx = 0;
  cols = 80; rows = 24; version = 0;
  /** Scrollback cap (main screen only). Alt-screen scroll-offs are discarded. */
  maxLines = 5000;
  cursorVisible = true;
  altActive = false;

  private screen: TerminalLine[];
  private scrollback: TerminalLine[] = [];
  private _cy = 0; // cursor row, RELATIVE TO SCREEN
  private _linesCache: TerminalLine[] | null = null;

  private fg?: string; private bg?: string; private bold=false; private italic=false; private underline=false; private inverse=false;
  private savedCx=0; private savedCy=0; // screen-relative — immune to scrollback trims
  private pending = ''; // split-sequence buffer
  private pendingWrap = false;
  private autoWrap = true;

  // ── Alternate screen storage (DEC 1047/1048/1049) ──────────────────────
  private mainScreen: TerminalLine[] | null = null;
  private altScreen: TerminalLine[] | null = null;

  constructor() {
    this.screen = TerminalBuffer.blankRows(this.rows);
  }

  // ── Renderer-facing view ─────────────────────────────────────────────────
  // The renderer works with one combined array: scrollback lines followed by
  // screen lines.  Cached until the next structural change (scroll, resize,
  // ED, alt switch) — cell-level mutations share line references.

  get lines(): TerminalLine[] {
    if (!this._linesCache) this._linesCache = this.scrollback.concat(this.screen);
    return this._linesCache;
  }

  /** Absolute cursor row within `lines` (scrollback.length + screen row). */
  get cy(): number {
    return this.scrollback.length + this._cy;
  }

  private static blankRow(): TerminalLine { return { cells: [], dirty: false }; }
  private static blankRows(n: number): TerminalLine[] {
    return Array.from({ length: n }, () => TerminalBuffer.blankRow());
  }
  private static isBlank(l: TerminalLine): boolean {
    return l.cells.every((c) => c.char === ' ');
  }

  // ── Alternate screen (DEC 1047/1048/1049) ──────────────────────────────
  // Full-screen programs (vim, htop, Claude Code) draw into a separate
  // screen so the shell's scrollback stays clean and is restored on exit.

  /** DEC 1047h / 1049h — switch to the alternate screen. */
  private enterAlt(clear: boolean, saveCursor: boolean): void {
    if (this.altActive) {
      // Re-entry while already in alt (nested TUI): just clear if asked.
      if (clear) {
        this.screen = TerminalBuffer.blankRows(this.rows);
        this.cx = 0; this._cy = 0; this.pendingWrap = false;
        this._linesCache = null;
      }
      return;
    }
    this.mainScreen = this.screen;
    if (saveCursor) { this.savedCx = this.cx; this.savedCy = this._cy; }
    this.screen = (!clear && this.altScreen) ? this.altScreen : TerminalBuffer.blankRows(this.rows);
    this.altScreen = null; // now the live screen
    this.cx = 0; this._cy = 0; this.pendingWrap = false;
    this.altActive = true;
    this._linesCache = null;
  }

  /** DEC 1047l / 1049l — switch back to the main screen. */
  private exitAlt(restoreCursor: boolean): void {
    if (!this.altActive) return;
    this.altScreen = this.screen;
    this.screen = this.mainScreen ?? TerminalBuffer.blankRows(this.rows);
    this.mainScreen = null;
    // The window may have been resized while in alt — normalize the main
    // screen back to `rows` lines (grow pulls scrollback back down, shrink
    // pushes top lines up), adjusting the saved cursor row to match.
    while (this.screen.length < this.rows) {
      if (this.scrollback.length > 0) {
        this.screen.unshift(this.scrollback.pop()!);
        if (restoreCursor) this.savedCy++;
      } else {
        this.screen.push(TerminalBuffer.blankRow());
      }
    }
    while (this.screen.length > this.rows) {
      const top = this.screen.shift()!;
      this.scrollback.push(top);
      if (this.scrollback.length > this.maxLines) this.scrollback.shift();
      if (restoreCursor && this.savedCy > 0) this.savedCy--;
    }
    if (restoreCursor) {
      this.cx = Math.min(this.savedCx, this.cols - 1);
      this._cy = Math.min(this.savedCy, this.rows - 1);
    } else {
      this._cy = Math.min(this._cy, this.rows - 1);
    }
    this.pendingWrap = false;
    this.altActive = false;
    this._linesCache = null;
  }

  // ── Main entry ─────────────────────────────────────────────────────────────

  write(data: string): void {
    data = this.pending + data;
    this.pending = '';

    let i = 0;
    const len = data.length;
    while (i < len) {
      const c = data.charCodeAt(i);

      if (c === 0x1b && i + 1 < len) {               // ESC sequence
        const start = i; i++;
        const next = data[i];
        if (next === '[') {                           // CSI
          i++;
          let complete = false;
          while (i < len) {
            const fc = data.charCodeAt(i);
            if (fc >= 0x40 && fc <= 0x7e) {
              this.doCsi(fc, data, start + 2, i);     // pass final byte + param slice (no alloc)
              i++; complete = true; break;
            }
            i++;
          }
          if (!complete) { this.pending = data.slice(start); return; }
          continue;
        }
        if (next === ']') {                           // OSC
          i++;
          while (i < len && data.charCodeAt(i) !== 0x07 && data[i] !== '\x1b') i++;
          if (i >= len) { this.pending = data.slice(start); return; }
          if (data.charCodeAt(i) === 0x07) { i++; }
          else if (data[i] === '\x1b') {
            if (i + 1 >= len) { this.pending = data.slice(start); return; }
            if (data[i + 1] === '\\') i += 2;
          }
          continue;
        }
        // DCS / SOS / PM / APC — skip to ST
        if (next === 'P' || next === 'X' || next === '^' || next === '_') {
          i++;
          let complete = false;
          while (i < len) {
            if (data[i] === '\x1b' && i + 1 < len && data[i + 1] === '\\') { i += 2; complete = true; break; }
            i++;
          }
          if (!complete) { this.pending = data.slice(start); return; }
          continue;
        }
        // DECSC / DECRC (ESC 7 / ESC 8) — same semantics as CSI s / CSI u.
        if (next === '7') { this.savedCx = this.cx; this.savedCy = this._cy; i++; continue; }
        if (next === '8') { this.cx = Math.min(this.savedCx, this.cols - 1); this._cy = Math.min(this.savedCy, this.rows - 1); this.pendingWrap = false; i++; continue; }
        // Charset designation (ESC ( B, ESC ( 0, …) and DEC specials (ESC # 8):
        // a FINAL byte follows the designator — skip both, otherwise the
        // final byte (e.g. 'B') leaks into the text stream as garbage.
        if (next === '(' || next === ')' || next === '*' || next === '+' || next === '#') {
          if (i + 1 >= len) { this.pending = data.slice(start); return; }
          i += 2;
          continue;
        }
        i++; // simple ESC
        continue;
      }

      if (c === 0x1b) { this.pending = data.slice(i); return; } // lone ESC

      // Control chars
      if (c === 0x0d) { this.cx = 0; this.pendingWrap = false; i++; continue; }
      if (c === 0x0a) { this.pendingWrap = false; this.lf(); i++; continue; }
      if (c === 0x08) { this.pendingWrap = false; if (this.cx > 0) this.cx--; i++; continue; }
      if (c === 0x09) { this.pendingWrap = false; this.cx = Math.min(this.cols-1, (Math.floor(this.cx/8)+1)*8); i++; continue; }
      if (c < 0x20) { i++; continue; }

      this.putChar(data[i]); i++;
    }
    this.version++;
  }

  // ── CSI handler — final byte f, params in data[pos..end) ───────────────────

  private doCsi(f: number, data: string, pos: number, end: number): void {
    const firstByte = data.charCodeAt(pos);
    const isPrivate = firstByte === 0x3f /* ? */;
    // xterm private sequences (`>`, `<`, `=` prefix — e.g. CSI > 4 m
    // modifyOtherKeys, CSI < u kitty keyboard) must be IGNORED, not
    // reinterpreted as the standard sequence with the same final byte.
    if (firstByte === 0x3e /* > */ || firstByte === 0x3c /* < */ || firstByte === 0x3d /* = */) return;
    const pStart = isPrivate ? pos + 1 : pos;
    const [p] = parseCsiParams(data, pStart, end);

    if (isPrivate) {
      if (f !== 0x68 /* h */ && f !== 0x6c /* l */) return;
      const set = f === 0x68;
      for (const n of p) { const h = TerminalBuffer.DEC[n]; if (h) h(this, set); }
      return;
    }

    const handler = TerminalBuffer.CSI[f];
    if (handler) handler(this, p);
  }

  // ── Dispatch tables ────────────────────────────────────────────────────────

  // prettier-ignore
  private static CSI: Record<number, (b: TerminalBuffer, p: number[]) => void> = {
    0x6d /* m */: (b, p) => b.sgr(p),
    0x41 /* A */: (b, p) => { b._cy = Math.max(0, b._cy - (p[0] || 1)); b.pendingWrap = false; },
    0x42 /* B */: (b, p) => { b._cy = Math.min(b.rows - 1, b._cy + (p[0] || 1)); b.pendingWrap = false; },
    0x43 /* C */: (b, p) => { b.cx = Math.min(b.cols - 1, b.cx + (p[0] || 1)); b.pendingWrap = false; },
    0x44 /* D */: (b, p) => { b.cx = Math.max(0, b.cx - (p[0] || 1)); b.pendingWrap = false; },
    0x48 /* H */: (b, p) => { b._cy = Math.min(b.rows - 1, Math.max(0, (p[0] || 1) - 1)); b.cx = Math.min(b.cols - 1, (p[1] || 1) - 1); b.pendingWrap = false; },
    0x47 /* G */: (b, p) => { b.cx = Math.min(b.cols - 1, (p[0] || 1) - 1); b.pendingWrap = false; },
    0x64 /* d */: (b, p) => { b._cy = Math.min(b.rows - 1, Math.max(0, (p[0] || 1) - 1)); b.pendingWrap = false; },
    0x73 /* s */: (b, _p) => { b.savedCx = b.cx; b.savedCy = b._cy; },
    0x75 /* u */: (b, _p) => { b.cx = b.savedCx; b._cy = Math.min(b.savedCy, b.rows - 1); b.pendingWrap = false; },
    0x4a /* J */: (b, p) => b.ed(p[0] || 0),
    0x4b /* K */: (b, p) => {
      const ln = b.line();
      if ((p[0] || 0) === 0) ln.cells = ln.cells.slice(0, b.cx);
      else if ((p[0] || 0) === 2) ln.cells = [];
      ln.dirty = true;
    },
  };

  // prettier-ignore
  private static DEC: Record<number, (b: TerminalBuffer, set: boolean) => void> = {
    25: (b, v) => { b.cursorVisible = v; },
    7:  (b, v) => { b.autoWrap = v; if (!v) b.pendingWrap = false; },
    1047: (b, v) => { if (v) b.enterAlt(false, false); else b.exitAlt(false); },
    1048: (b, v) => { // DECSC/DECRC — shares the saved-cursor slot with CSI s/u
      if (v) { b.savedCx = b.cx; b.savedCy = b._cy; }
      else { b.cx = Math.min(b.savedCx, b.cols - 1); b._cy = Math.min(b.savedCy, b.rows - 1); b.pendingWrap = false; }
    },
    1049: (b, v) => { if (v) b.enterAlt(true, true); else b.exitAlt(true); },
    2004: (_b, _v) => {},
  };

  // ── SGR ────────────────────────────────────────────────────────────────────

  private sgr(p: number[]): void {
    if (p.length === 0 || (p.length === 1 && p[0] === 0)) {
      this.fg = this.bg = undefined; this.bold = this.italic = this.underline = this.inverse = false; return;
    }
    for (let i = 0; i < p.length; i++) {
      const v = p[i];
      if (v === 0) { this.fg=undefined; this.bg=undefined; this.bold=false; this.italic=false; this.underline=false; }
      else if (v === 1) this.bold = true;
      else if (v === 3) this.italic = true;
      else if (v === 4) this.underline = true;
      else if (v === 7) this.inverse = true;
      else if (v === 22) this.bold = false;
      else if (v === 23) this.italic = false;
      else if (v === 24) this.underline = false;
      else if (v === 27) this.inverse = false;
      else if (v === 39) this.fg = undefined;
      else if (v === 49) this.bg = undefined;
      else if (v === 38 && i + 2 < p.length) {
        if (p[i + 1] === 5) { this.fg = X256[p[i + 2]]; i += 2; }
        else if (p[i + 1] === 2 && i + 4 < p.length) {
          this.fg = `#${p[i+2].toString(16).padStart(2,'0')}${p[i+3].toString(16).padStart(2,'0')}${p[i+4].toString(16).padStart(2,'0')}`; i += 4;
        } else { i += 2; }
      }
      else if (v === 48 && i + 2 < p.length) {
        if (p[i + 1] === 5) { this.bg = X256[p[i + 2]]; i += 2; }
        else if (p[i + 1] === 2 && i + 4 < p.length) {
          this.bg = `#${p[i+2].toString(16).padStart(2,'0')}${p[i+3].toString(16).padStart(2,'0')}${p[i+4].toString(16).padStart(2,'0')}`; i += 4;
        } else { i += 2; }
      }
      else if (FG[v]) this.fg = FG[v];
      else if (BG[v]) this.bg = BG[v];
    }
  }

  // ── Erase in display (ED) ────────────────────────────────────────────────

  private ed(mode: number): void {
    if (mode === 2) {
      // Clear the whole screen (scrollback preserved — that's ED 3's job).
      this.screen = TerminalBuffer.blankRows(this.rows);
      this.cx = 0; this._cy = 0; this.pendingWrap = false;
      this._linesCache = null;
    } else if (mode === 3) {
      // xterm extension: clear scrollback.
      this.scrollback = [];
      this._linesCache = null;
    } else if (mode === 0) {
      // Clear from cursor to END OF SCREEN (not scrollback).
      const ln = this.line();
      ln.cells = ln.cells.slice(0, this.cx);
      ln.dirty = true;
      for (let y = this._cy + 1; y < this.screen.length; y++) {
        this.screen[y].cells = [];
        this.screen[y].dirty = true;
      }
    }
  }

  // ── Char output ────────────────────────────────────────────────────────────

  private putChar(ch: string): void {
    const w = charWidth(ch.codePointAt(0) ?? 0);
    if (w === 0) return;
    if (w === 2 && this.cx >= this.cols - 1) { this.cx = 0; this.lf(); }
    if (this.pendingWrap) { this.cx = 0; this.lf(); this.pendingWrap = false; }

    const ln = this.line();
    while (ln.cells.length <= this.cx + w - 1) ln.cells.push({ char: ' ' });

    const effFg = this.fg || DEF_FG;
    const effBg = this.bg || DEF_BG;
    const cellFg = this.inverse ? effBg : this.fg;
    const cellBg = this.inverse ? effFg : this.bg;

    ln.cells[this.cx] = { char: ch, fg: cellFg, bg: cellBg, bold: this.bold, italic: this.italic, underline: this.underline };
    ln.dirty = true;
    if (w === 2) ln.cells[this.cx + 1] = { char: '', wide: true, fg: cellFg, bg: cellBg };

    if (this.cx + w >= this.cols) {
      if (this.autoWrap) this.pendingWrap = true;
      this.cx = this.cols - 1;
    } else {
      this.cx += w;
    }
  }

  private line(): TerminalLine {
    return this.screen[this._cy];
  }

  private lf(): void {
    if (this._cy >= this.rows - 1) this.scrollUp();
    else this._cy++;
  }

  /** Bottom-edge scroll: the top screen line leaves the screen. */
  private scrollUp(): void {
    const top = this.screen.shift()!;
    if (!this.altActive) {
      this.scrollback.push(top);
      if (this.scrollback.length > this.maxLines) this.scrollback.shift();
    }
    // Alt screen: no scrollback — the scrolled-off line is discarded.
    this.screen.push(TerminalBuffer.blankRow());
    this._linesCache = null;
  }

  // ── Typed event API (used by the Rust parser pipeline) ─────────────────────

  applyEvents(events: TerminalEvent[]): void {
    for (const ev of events) {
      switch (ev.t) {
        case 'txt': for (let i = 0; i < ev.p.length; i++) this.putChar(ev.p[i]); break;
        case 'cr': this.cx = 0; this.pendingWrap = false; break;
        case 'lf': this.pendingWrap = false; this.lf(); break;
        case 'bs': this.pendingWrap = false; if (this.cx > 0) this.cx--; break;
        case 'tab': this.pendingWrap = false; this.cx = Math.min(this.cols - 1, (Math.floor(this.cx / 8) + 1) * 8); break;
        // CSI cursor movement: params of 0 mean "default to 1" per ECMA-48.
        // The Rust parser emits 0 for empty/unspecified params via parse_csi.
        case 'A': this._cy = Math.max(0, this._cy - (ev.p || 1)); this.pendingWrap = false; break;
        case 'B': this._cy = Math.min(this.rows - 1, this._cy + (ev.p || 1)); this.pendingWrap = false; break;
        case 'C': this.cx = Math.min(this.cols - 1, this.cx + (ev.p || 1)); this.pendingWrap = false; break;
        case 'D': this.cx = Math.max(0, this.cx - (ev.p || 1)); this.pendingWrap = false; break;
        case 'H': this._cy = Math.min(this.rows - 1, Math.max(0, (ev.p[0] || 1) - 1)); this.cx = Math.min(this.cols - 1, (ev.p[1] || 1) - 1); this.pendingWrap = false; break;
        case 'G': this.cx = Math.min(this.cols - 1, (ev.p || 1) - 1); this.pendingWrap = false; break;
        case 'd': this._cy = Math.min(this.rows - 1, Math.max(0, (ev.p || 1) - 1)); this.pendingWrap = false; break;
        case 's': this.savedCx = this.cx; this.savedCy = this._cy; break;
        case 'u': this.cx = this.savedCx; this._cy = Math.min(this.savedCy, this.rows - 1); this.pendingWrap = false; break;
        case 'J': this.ed(ev.p); break;
        case 'K': {
          const ln = this.line();
          if (ev.p === 0) ln.cells = ln.cells.slice(0, this.cx);
          else if (ev.p === 2) ln.cells = [];
          ln.dirty = true;
          break;
        }
        case 'm': this.sgr(ev.p); break;
        case 'dec': {
          const h = TerminalBuffer.DEC[ev.p[0]];
          if (h) h(this, ev.p[1]);
          break;
        }
        case 'osc': break; // title — handled by the PTY listener in useDomTerminal
      }
    }
    this.version++;
  }

  resize(cols: number): void { if (cols >= 10) { this.cols = cols; this.cx = Math.min(this.cx, cols - 1); this.pendingWrap = false; } }

  /**
   * Change the screen height.  Shrinking moves lines above the cursor into
   * scrollback (main) or discards them (alt) — blank padding below the
   * cursor is dropped first since it's invisible anyway.  Growing pulls
   * lines back down from scrollback, then pads with blanks.  The cursor
   * line stays on screen throughout.
   */
  setRows(newRows: number): void {
    if (newRows < 4) newRows = 4;
    if (newRows === this.rows) return;
    if (newRows < this.rows) {
      let excess = this.rows - newRows;
      while (excess > 0 && this.screen.length - 1 > this._cy && TerminalBuffer.isBlank(this.screen[this.screen.length - 1])) {
        this.screen.pop();
        excess--;
      }
      while (excess > 0 && this.screen.length > 1) {
        const top = this.screen.shift()!;
        if (!this.altActive) {
          this.scrollback.push(top);
          if (this.scrollback.length > this.maxLines) this.scrollback.shift();
        }
        if (this._cy > 0) this._cy--;
        excess--;
      }
    } else {
      let deficit = newRows - this.rows;
      while (deficit > 0 && !this.altActive && this.scrollback.length > 0) {
        this.screen.unshift(this.scrollback.pop()!);
        this._cy++;
        deficit--;
      }
      while (deficit > 0) {
        this.screen.push(TerminalBuffer.blankRow());
        deficit--;
      }
    }
    // Normalize to exactly newRows lines (guards against pathological states)
    while (this.screen.length < newRows) this.screen.push(TerminalBuffer.blankRow());
    if (this.screen.length > newRows) this.screen.length = newRows;
    this.rows = newRows;
    this._cy = Math.min(this._cy, newRows - 1);
    this._linesCache = null;
    this.version++;
  }

  clear(): void {
    this.screen = TerminalBuffer.blankRows(this.rows);
    this.scrollback = [];
    this.cx = 0; this._cy = 0; this.pendingWrap = false;
    this._linesCache = null;
    this.version++;
  }
}
