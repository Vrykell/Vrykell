import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import BlockOutput, { plainText } from '@features/terminal/components/BlockOutput';

// ═══════ Mock @xterm/xterm ═══════
// xterm.js requires canvas + matchMedia which jsdom doesn't fully support.
// We provide a mock Terminal with a simple ANSI parser.

const SGR_FG_COLORS: Record<number, number> = {
  30: 0, 31: 1, 32: 2, 33: 3, 34: 4, 35: 5, 36: 6, 37: 7,
  90: 8, 91: 9, 92: 10, 93: 11, 94: 12, 95: 13, 96: 14, 97: 15,
};

interface CellData {
  chars: string; width: number; fg: number; bg: number;
  fgDefault: boolean; bgDefault: boolean;
  bold: boolean; italic: boolean; underline: boolean;
  strikethrough: boolean; dim: boolean; inverse: boolean;
}

function emptyCell(): CellData {
  return { chars: ' ', width: 1, fg: 0, bg: 0, fgDefault: true, bgDefault: true,
    bold: false, italic: false, underline: false, strikethrough: false, dim: false, inverse: false };
}

function parseAnsi(data: string): CellData[][] {
  const lines: CellData[][] = [[]];
  let x = 0;
  let sgr: Partial<CellData> = { fgDefault: true, bgDefault: true };
  let i = 0;
  while (i < data.length) {
    if (data[i] === '\x1b' && data[i+1] === '[') {
      const end = data.indexOf('m', i+2);
      if (end !== -1 && /^[0-9;]*$/.test(data.slice(i+2, end))) {
        for (const p of data.slice(i+2, end).split(';').map(Number)) {
          if (p === 0) { sgr = { fgDefault: true, bgDefault: true }; }
          else if (p === 1) sgr.bold = true; else if (p === 2) sgr.dim = true;
          else if (p === 3) sgr.italic = true; else if (p === 4) sgr.underline = true;
          else if (p === 7) sgr.inverse = true; else if (p === 9) sgr.strikethrough = true;
          else if (p === 22) { sgr.bold = false; sgr.dim = false; }
          else if (p === 23) sgr.italic = false; else if (p === 24) sgr.underline = false;
          else if (p === 27) sgr.inverse = false; else if (p === 29) sgr.strikethrough = false;
          else if (p >= 30 && p <= 37) { sgr.fg = SGR_FG_COLORS[p]!; sgr.fgDefault = false; }
          else if (p >= 40 && p <= 47) { sgr.bg = p-40; sgr.bgDefault = false; }
          else if (p >= 90 && p <= 97) { sgr.fg = SGR_FG_COLORS[p]!; sgr.fgDefault = false; }
          else if (p >= 100 && p <= 107) { sgr.bg = p-100+8; sgr.bgDefault = false; }
          else if (p === 39) { sgr.fgDefault = true; sgr.fg = undefined; }
          else if (p === 49) { sgr.bgDefault = true; sgr.bg = undefined; }
        }
        i = end+1; continue;
      }
    }
    if (data[i] === '\x1b' && data[i+1] === ']') { const e = data.indexOf('\x07', i); i = e===-1 ? data.length : e+1; continue; }
    if (data[i] === '\x1b' && data[i+1] === 'P') { const e = data.indexOf('\x1b\\', i); i = e===-1 ? data.length : e+2; continue; }
    if (data[i] === '\x1b') { let j = i+1; if (j<data.length && data[j]==='[') { j++; while (j<data.length && data[j].charCodeAt(0)<0x40) j++; if (j<data.length) j++; } i=j; continue; }
    if (data[i] === '\n') { lines.push([]); x=0; i++; continue; }
    if (data[i] === '\r') { x=0; i++; continue; }
    const line = lines[lines.length-1]!;
    while (line.length < x) line.push(emptyCell());
    line[x] = { ...emptyCell(), chars: data[i]!, ...sgr };
    x++; i++;
  }
  while (lines.length > 0 && lines[lines.length-1]!.every(c => c.chars === ' ')) lines.pop();
  return lines;
}

function toMockCell(d: CellData) {
  return {
    getChars: () => d.chars, getWidth: () => d.width,
    getFgColor: () => d.fg||0, getBgColor: () => d.bg||0,
    isFgDefault: () => d.fgDefault, isBgDefault: () => d.bgDefault,
    isFgRGB: () => false, isBgRGB: () => false,
    isFgPalette: () => !d.fgDefault && d.fg!==undefined,
    isBgPalette: () => !d.bgDefault && d.bg!==undefined,
    isBold: () => d.bold, isItalic: () => d.italic,
    isUnderline: () => d.underline, isStrikethrough: () => d.strikethrough,
    isDim: () => d.dim, isInverse: () => d.inverse,
    isBlink: () => false, isInvisible: () => false, isOverline: () => false,
  };
}

// eslint-disable-next-line no-var
var mockLines: CellData[][] = [];
// eslint-disable-next-line no-var
var mockTextLines: string[] = [];

vi.mock('@xterm/xterm', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const MockTerminal = function (this: any, _opts: { cols: number; rows: number }) {
    mockLines = []; mockTextLines = [];
    this.buffer = {
      active: {
        get length() { return mockLines.length; },
        getLine(y: number) {
          const cells = mockLines[y]; if (!cells) return null;
          return { translateToString() { return mockTextLines[y] || ''; },
            getCell(x: number) { if (x >= cells.length) return undefined; return toMockCell(cells[x]!); } };
        },
        getNullCell() { return toMockCell(emptyCell()); },
      },
    };
    this.open = vi.fn();
    this.write = vi.fn((data: string, cb?: () => void) => {
      mockLines = parseAnsi(data);
      mockTextLines = mockLines.map((l) => l.map(c => c.chars).join('').replace(/ +$/, ''));
      if (cb) cb();
    });
    this.dispose = vi.fn();
    this.element = undefined;
  };
  return { Terminal: MockTerminal };
});

import { captureTerminalOutput, extractSnapshotFromBuffer } from '@features/terminal/model/terminalSnapshot';

describe('extractSnapshotFromBuffer 宽字符', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mkCell = (chars: string, width: number): any => ({
    getChars: () => chars, getWidth: () => width,
    getFgColor: () => 0, getBgColor: () => 0,
    isFgDefault: () => true, isBgDefault: () => true,
    isFgRGB: () => false, isBgRGB: () => false,
    isFgPalette: () => false, isBgPalette: () => false,
    isBold: () => false, isItalic: () => false, isUnderline: () => false,
    isStrikethrough: () => false, isDim: () => false, isInverse: () => false,
  });

  it('CJK 全宽字符包 2ch inline-block（渲染宽度与网格对齐）', () => {
    const cells = [mkCell('a', 1), mkCell('你', 2), mkCell('', 0), mkCell('b', 1)];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buf: any = {
      length: 1,
      getLine: () => ({ translateToString: () => 'a你b', getCell: (x: number) => cells[x] }),
      getNullCell: () => mkCell(' ', 1),
    };
    const snap = extractSnapshotFromBuffer(buf, 80);
    expect(snap.html).toBe('a<span style="display:inline-block;width:2ch">你</span>b');
    expect(snap.plainText).toBe('a你b');
  });
});



// ═══════════════════════════════════════════
// captureTerminalOutput — ANSI → HTML + plainText
// ═══════════════════════════════════════════

describe('captureTerminalOutput ANSI 处理', () => {
  it('移除 OSC 133 序列并截断提示符', async () => {
    const input = 'hello\x1b]133;D;0\x07 world\x1b]133;A\x07!';
    const { html, plainText } = await captureTerminalOutput(input, 80);
    expect(html).not.toContain('133;D');
    expect(html).not.toContain('133;A');
    expect(plainText).not.toContain('133;D');
    expect(plainText).not.toContain('133;A');
    expect(plainText).not.toContain('!');
  });

  it('保留 SGR 颜色码并产出 styled HTML', async () => {
    const input = '\x1b[32mgreen\x1b[0m text';
    const { html, plainText } = await captureTerminalOutput(input, 80);
    expect(html).toMatch(/color/);
    expect(html).toContain('green');
    expect(html).toContain('text');
    expect(plainText).toContain('green');
    expect(plainText).not.toContain('\x1b');
  });

  it('处理括号粘贴模式 CSI', async () => {
    const input = 'output\x1b[?2004h\nmore output';
    const { plainText } = await captureTerminalOutput(input, 80);
    expect(plainText).toContain('output');
    expect(plainText).toContain('more output');
  });

  it('处理 DCS 序列', async () => {
    const input = 'before\x1bP0;0;0q"txt"\x1b\\after';
    const { plainText } = await captureTerminalOutput(input, 80);
    expect(plainText).toContain('before');
    expect(plainText).toContain('after');
  });

  it('正确处理光标移动 CSI（被 mock 跳过，文字保留）', async () => {
    const input = '\x1b[2J\x1b[Hhello\x1b[10;1Hworld';
    const { plainText } = await captureTerminalOutput(input, 80);
    expect(plainText).toContain('hello');
    expect(plainText).toContain('world');
  });

  it('OSC 133 E 序列被移除', async () => {
    const input = 'before\x1b]133;E;d2hpY2ggbHMK\x07after';
    const { html, plainText } = await captureTerminalOutput(input, 80);
    expect(plainText).not.toContain('d2hpY2ggbHMK');
    expect(plainText).toContain('before');
    expect(plainText).toContain('after');
    expect(html).not.toContain('d2hpY2ggbHMK');
  });

  it('连续多个 OSC 133 序列：在最后一个 A 处截断', async () => {
    const input = '\x1b]133;D;0\x07\x1b]133;A\x07prompt here';
    const { plainText } = await captureTerminalOutput(input, 80);
    expect(plainText).not.toContain('prompt here');
  });

  it('加粗样式生成 font-weight:bold', async () => {
    const { html } = await captureTerminalOutput('\x1b[1mbold\x1b[0m normal', 80);
    expect(html).toMatch(/font-weight:\s*bold/);
  });

  it('斜体样式生成 font-style:italic', async () => {
    const { html } = await captureTerminalOutput('\x1b[3mitalic\x1b[0m normal', 80);
    expect(html).toMatch(/font-style:\s*italic/);
  });

  it('下划线样式生成 text-decoration:underline', async () => {
    const { html } = await captureTerminalOutput('\x1b[4munder\x1b[0m normal', 80);
    expect(html).toMatch(/text-decoration:\s*underline/);
  });

  it('空格不转义为 &nbsp;（避免 HTML 检测失败）', async () => {
    const { html } = await captureTerminalOutput('  indented text', 80);
    expect(html).not.toContain('&nbsp;');
    // 应以 <span> 开头（若样式存在）或直接是空格+文本
    expect(html).toContain('indented text');
  });
});

// ═══════════════════════════════════════════
// 真实输出测试：提示符截断
// ═══════════════════════════════════════════

describe('captureTerminalOutput 提示符截断', () => {
  it('真实 ls 输出：末尾提示符行被移除', async () => {
    const input = 'Desktop\r\nDocuments\r\nDownloads\r\n' +
      '\x1b]133;D;0\x07\x1b]133;A\x07' + 'wuzhe@wuzhedeMacBook-Pro ~ % ';
    const { html, plainText } = await captureTerminalOutput(input, 80);
    expect(plainText).toContain('Desktop');
    expect(plainText).toContain('Documents');
    expect(plainText).toContain('Downloads');
    expect(html).not.toContain('wuzhe@wuzhedeMacBook-Pro');
    expect(plainText).not.toContain('wuzhe@wuzhedeMacBook-Pro');
  });

  it('git status 输出：末尾提示符行被移除', async () => {
    const input = 'On branch main\r\nnothing to commit, working tree clean\r\n' +
      '\x1b]133;D;0\x07\x1b]133;A\x07' + '\x1b[32mwuzhe@host\x1b[0m ~ % ';
    const { plainText } = await captureTerminalOutput(input, 80);
    expect(plainText).toContain('On branch main');
    expect(plainText).toContain('nothing to commit');
    expect(plainText).not.toContain('wuzhe@host');
  });

  it('python 输出：进度条 % 保留，提示符移除', async () => {
    const input = 'Training: 100%|████| 100/100 [00:10<00:00]\r\nDone\r\n' +
      '\x1b]133;D;0\x07\x1b]133;A\x07' + 'user@host ~ % ';
    const { plainText } = await captureTerminalOutput(input, 80);
    expect(plainText).toContain('100%');
    expect(plainText).toContain('Done');
    expect(plainText).not.toContain('user@host');
  });

  it('空输出命令：仅提示符行被移除', async () => {
    const input = '\x1b]133;D;0\x07\x1b]133;A\x07' + 'user@host ~ $ ';
    const { html } = await captureTerminalOutput(input, 80);
    expect(html.trim()).toBe('');
  });
});

// ═══════════════════════════════════════════
// plainText — HTML 转义
// ═══════════════════════════════════════════

describe('plainText HTML 转义', () => {
  it('HTML 特殊字符被转义', () => {
    expect(plainText('<script>alert("xss")</script>')).not.toContain('<script>');
    expect(plainText('<script>alert("xss")</script>')).toContain('&lt;script&gt;');
  });
  it('保留普通文本不变', () => {
    expect(plainText('hello world')).toBe('hello world');
  });
  it('转义 & 符号', () => {
    expect(plainText('a & b')).toBe('a &amp; b');
  });
});

// ═══════════════════════════════════════════
// BlockOutput 组件渲染
// ═══════════════════════════════════════════

describe('BlockOutput 组件', () => {
  it('preserves terminal grid rows and allows wide historical output to scroll', () => {
    const { container } = render(<BlockOutput isHtml text={'mode    length    name<br>-a--    128       file.txt'} maxHeight={120} />);
    const output = container.querySelector<HTMLElement>('[data-selectable]')!;
    expect(output.style.whiteSpace).toBe('pre');
    expect(output.style.wordBreak).toBe('normal');
    expect(output.style.overflowX).toBe('auto');
    expect(output.style.overflowY).toBe('auto');
    expect(output.querySelectorAll('br')).toHaveLength(1);
    expect(output.textContent).toContain('128       file.txt');
  });
  it('渲染纯文本', () => {
    const { container } = render(<BlockOutput text="hello: world" />);
    expect(container.innerHTML).toContain('hello');
    expect(container.innerHTML).toContain('world');
  });

  it('渲染 styled HTML（outputHtml 模式，显式 isHtml）', () => {
    const { container } = render(
      <BlockOutput isHtml text={'<span style="color:#cc0000">error</span>: <span style="font-weight:bold">failed</span>'} />
    );
    expect(container.querySelector('span[style*="color:#cc0000"]')).toBeTruthy();
    expect(container.innerHTML).toContain('failed');
  });

  it('HTML 模式使用 innerHTML 渲染（显式 isHtml）', () => {
    const { container } = render(<BlockOutput isHtml text={'<span style="color:#4e9a06">success</span>'} />);
    const span = container.querySelector('span[style*="color:#4e9a06"]');
    expect(span).toBeTruthy();
    expect(span!.textContent).toBe('success');
  });

  it('未传 isHtml 时不再嗅探 <span，历史输出按纯文本转义（防存储型 XSS）', () => {
    const { container } = render(
      <BlockOutput text={'<span style="color:#cc0000">error</span><img src=x onerror=alert(1)>'} />
    );
    // 不产生任何真实元素，全部转义为文本
    expect(container.querySelector('span')).toBeFalsy();
    expect(container.querySelector('img')).toBeFalsy();
    expect(container.textContent).toContain('&lt;span');
  });

  it('纯文本模式转义 HTML 字符', () => {
    const { container } = render(<BlockOutput text="<b>bold</b>" />);
    expect(container.querySelector('b')).toBeFalsy();
    // In text mode, < and > are escaped to &lt; and &gt; via plainText()
    expect(container.textContent).toBe('&lt;b&gt;bold&lt;/b&gt;');
  });
});
