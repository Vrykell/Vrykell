import { RichContentType, DetectedBlock } from '../../shared/types';
import { detectRichContent } from '../services/content-detector';

// ── Types ──────────────────────────────────────────────

export interface Cell {
  char: string;
  fg?: string;
  bg?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface RichBlock {
  type: RichContentType;
  content: string;
  language?: string;
  display?: 'inline' | 'block';
}

export interface TerminalLine {
  cells: Cell[];
  richBlock?: RichBlock;
  dirty: boolean;
}

const ANSI_FG: Record<number, string> = {
  30: '#000', 31: '#cd3131', 32: '#0dbc79', 33: '#e5e510',
  34: '#2472c8', 35: '#bc3fbc', 36: '#11a8cd', 37: '#e5e5e5',
  90: '#666', 91: '#f14c4c', 92: '#23d18b', 93: '#f5f543',
  94: '#3b8eea', 95: '#d670d6', 96: '#29b8db', 97: '#fff',
};

const ANSI_BG: Record<number, string> = {
  40: '#000', 41: '#cd3131', 42: '#0dbc79', 43: '#e5e510',
  44: '#2472c8', 45: '#bc3fbc', 46: '#11a8cd', 47: '#e5e5e5',
  100: '#666', 101: '#f14c4c', 102: '#23d18b', 103: '#f5f543',
  104: '#3b8eea', 105: '#d670d6', 106: '#29b8db', 107: '#fff',
};

// ── TerminalBuffer ─────────────────────────────────────

export class TerminalBuffer {
  lines: TerminalLine[] = [];
  cursorRow = 0;
  cursorX = 0;
  cols = 80;

  private currentFg?: string;
  private currentBg?: string;
  private currentBold = false;
  private currentItalic = false;
  private currentUnderline = false;

  // ANSI parser state
  private escBuf = '';        // buffer for escape sequences
  private inEsc = false;
  private inCsi = false;      // inside CSI sequence (\x1b[)

  // Rich content detection
  private textSinceLastCheck = '';
  private checkTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(cols = 80) {
    this.cols = cols;
    this.cursorRow = 0;
    this.cursorX = 0;
    // Start with one empty line
    this.lines.push({ cells: [], dirty: false });
  }

  /** Ensure cursorRow points to a valid line */
  private ensureRow(): TerminalLine {
    while (this.lines.length <= this.cursorRow) {
      this.lines.push({ cells: [], dirty: false });
    }
    const line = this.lines[this.cursorRow];
    line.dirty = true;
    return line;
  }

  // ── Public API ──────────────────────────────────────

  /** Feed raw PTY output — may contain partial escape sequences */
  write(data: string): void {
    for (let i = 0; i < data.length; i++) {
      this.processChar(data.charCodeAt(i), data[i]);
    }

    // Schedule rich content check (debounced)
    this.textSinceLastCheck += data;
    if (this.checkTimer) clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => this.detectRichContent(), 300);
  }

  resize(cols: number): void {
    this.cols = cols;
    // Re-wrap: not perfect but good enough for shell output
    for (const line of this.lines) {
      if (line.cells.length > cols) {
        line.cells = line.cells.slice(0, cols);
        line.dirty = true;
      }
    }
  }

  clear(): void {
    this.lines = [{ cells: [], dirty: false }];
    this.cursorRow = 0;
    this.cursorX = 0;
  }

  // ── Character processing ────────────────────────────

  private processChar(code: number, ch: string): void {
    if (this.inEsc) {
      this.escBuf += ch;
      if (this.escBuf === '\x1b[') { this.inCsi = true; return; }

      // CSI terminated by a letter (e.g. \x1b[32m)
      if (this.inCsi && (code >= 64 && code <= 126)) {
        this.handleCsiSequence(this.escBuf);
        this.inEsc = false;
        this.inCsi = false;
        this.escBuf = '';
        return;
      }

      // Simple ESC sequences (single char after ESC)
      if (!this.inCsi && this.escBuf.length >= 2) {
        this.handleEscSequence(this.escBuf);
        this.inEsc = false;
        this.escBuf = '';
        return;
      }
      return;
    }

    if (code === 0x1b) { this.inEsc = true; this.escBuf = '\x1b'; return; }
    if (code === 0x07) { return; } // BEL — ignore
    if (code === 0x08) { this.backspace(); return; } // BS
    if (code === 0x09) { this.writeChar(' '); this.writeChar(' '); return; } // TAB
    if (code === 0x0d) { this.carriageReturn(); return; } // CR
    if (code === 0x0a) { this.newLine(); return; } // LF

    // Normal printable character (including Unicode)
    this.writeChar(ch);
  }

  private handleCsiSequence(seq: string): void {
    // seq looks like "\x1b[32m" or "\x1b[0m" or "\x1b[2K" or "\x1b[2A"
    const body = seq.slice(2, -1); // remove ESC[ prefix and final letter
    const final = seq[seq.length - 1];
    const params = body ? body.split(';').map(Number) : [];

    switch (final) {
      case 'm': this.applySGR(params.length === 0 ? [0] : params); break;
      case 'A': this.cursorUp(params[0] || 1); break;
      case 'K': this.eraseToEnd(); break;
      // Ignore other CSI sequences
    }
  }

  private handleEscSequence(seq: string): void {
    if (seq === '\x1b' + ']0;' || seq.startsWith('\x1b]0;')) {
      // OSC title change — handled by extract title, ignore here
    }
  }

  // ── Core operations ─────────────────────────────────

  private writeChar(ch: string): void {
    const line = this.ensureRow();
    const cell: Cell = {
      char: ch,
      fg: this.currentFg,
      bg: this.currentBg,
      bold: this.currentBold,
      italic: this.currentItalic,
      underline: this.currentUnderline,
    };
    if (this.cursorX < line.cells.length) {
      line.cells[this.cursorX] = cell;
    } else {
      line.cells.push(cell);
    }
    this.cursorX++;
  }

  private newLine(): void {
    this.cursorRow = this.lines.length;
    this.cursorX = 0;
    this.ensureRow();
  }

  private carriageReturn(): void {
    this.cursorX = 0;
  }

  private cursorUp(n: number): void {
    this.cursorRow = Math.max(0, this.cursorRow - n);
    this.ensureRow(); // mark the target row dirty
  }

  private eraseToEnd(): void {
    const line = this.ensureRow();
    line.cells = line.cells.slice(0, this.cursorX);
  }

  private backspace(): void {
    if (this.cursorX > 0) {
      this.cursorX--;
      const line = this.ensureRow();
      line.cells = line.cells.slice(0, this.cursorX);
    }
  }

  // ── SGR (Select Graphic Rendition) ──────────────────

  private applySGR(params: number[]): void {
    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      if (p === 0) {
        this.currentFg = undefined;
        this.currentBg = undefined;
        this.currentBold = false;
        this.currentItalic = false;
        this.currentUnderline = false;
      } else if (p === 1) {
        this.currentBold = true;
      } else if (p === 3) {
        this.currentItalic = true;
      } else if (p === 4) {
        this.currentUnderline = true;
      } else if (p >= 30 && p <= 37) {
        this.currentFg = ANSI_FG[p];
      } else if (p >= 90 && p <= 97) {
        this.currentFg = ANSI_FG[p];
      } else if (p >= 40 && p <= 47) {
        this.currentBg = ANSI_BG[p];
      } else if (p >= 100 && p <= 107) {
        this.currentBg = ANSI_BG[p];
      }
      // 38;5;n and 48;5;n (256-color) — skip for now
    }
  }

  // ── Rich content detection ──────────────────────────

  private detectRichContent(): void {
    if (this.textSinceLastCheck.length < 10) return;
    const { blocks } = detectRichContent(this.textSinceLastCheck);
    if (blocks.length === 0) return;
    this.textSinceLastCheck = '';

    // Find a contiguous area in recent lines to place the rich block
    const startRow = Math.max(0, this.lines.length - Math.ceil(blocks[0].content.split('\n').length) - 1);
    for (const block of blocks) {
      const lineCount = block.content.split('\n').length;
      for (let i = 0; i < lineCount && startRow + i < this.lines.length; i++) {
        const line = this.lines[startRow + i];
        line.cells = [];
        line.dirty = true;
      }
      if (this.lines[startRow]) {
        this.lines[startRow].richBlock = {
          type: block.type,
          content: block.content,
          language: block.language,
          display: block.display,
        };
        this.lines[startRow].dirty = true;
      }
    }
  }
}
