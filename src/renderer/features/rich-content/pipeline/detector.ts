import { DetectedBlock, RichContentType } from '../../../../shared/types/index';

/**
 * Scans terminal output text for rich content patterns.
 *
 * Important: terminal output contains ANSI escape sequences (colors, cursor
 * movement, etc.) which must be stripped BEFORE pattern matching, otherwise
 * they can trigger false positives (e.g. OSC codes, SGR parameters).
 */

/** Strip ANSI escape sequences from text before content detection */
function stripAnsi(text: string): string {
  // Remove CSI sequences: ESC [ ... m (SGR), ESC [ ... J/K/h/l etc.
  // Remove OSC sequences: ESC ] ... BEL or ESC ] ... ESC \
  // Remove DCS/other: ESC P ... ESC \ or ESC _ ... ESC \
  return text
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')   // CSI sequences
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC sequences
    .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, '') // DCS/PM/APC sequences
    .replace(/\x1b[()*+][0-9A-Z]/g, '')        // Character set selection
    .replace(/\x1b[=>]/g, '')                   // Application keypad
    .replace(/\x1b\][02];[^\x07\x1b]*(?:\x07|\x1b\\)/g, ''); // Title OSC
}

/**
 * Scans terminal output text for rich content patterns.
 * Phase 2: detects LaTeX, code blocks, Markdown tables, and URLs.
 *
 * Run this in a Web Worker for large outputs to avoid blocking the main thread.
 * For now, runs synchronously on small buffers.
 */

// ── Pattern Matchers ──────────────────────────────────────────

/** Match display LaTeX: $$...$$ or \[...\] (multi-line) */
const DISPLAY_LATEX_RE = /\$\$([^$]+)\$\$|\\\[([^\]]+)\\\]/gs;

/** Match inline LaTeX: $...$ or \(...\) (single-line, non-greedy) */
const INLINE_LATEX_RE = /\$([^$\n]+?)\$|\\\(([^)]+?)\\\)/g;

/** Match fenced code blocks: ```lang\n...\n``` */
const CODE_BLOCK_RE = /```(\w*)\n([\s\S]*?)```/g;

/** Match Markdown tables: | col1 | col2 | (at least one row with separator ---) */
const TABLE_RE = /(\|.+\|[\r\n]+\|[-:| ]+\|[\r\n]+(?:\|.+\|[\r\n]*)+)/g;

/** Match URLs (RFC 3986 subset — common web URLs) */
const URL_RE = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;

/** Match OSC AI markers from the protocol */
const OSC_AI_MARKER_RE = /\x1b\]AI;(LATEX|MARKDOWN|CODE|IMAGE)(?:;(\w+))?\x1b\\([\s\S]*?)\x1b\]AI;END\x1b\\/g;

// ── Detection Result ──────────────────────────────────────────

export interface DetectionResult {
  blocks: DetectedBlock[];
  /** Text with AI OSC markers stripped (for terminal display) */
  cleanedText: string;
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Detect rich content in terminal output text.
 * First checks for explicit OSC AI markers, then falls back to auto-detection.
 */
export function detectRichContent(text: string): DetectionResult {
  // Strip ANSI escape sequences first to prevent false positives
  const cleanText = stripAnsi(text);
  const blocks: DetectedBlock[] = [];
  let cleanedText = cleanText;

  // Layer 1: Explicit OSC AI markers (from AI tools)
  const oscBlocks = extractOscMarkers(text);
  if (oscBlocks.length > 0) {
    blocks.push(...oscBlocks);
    cleanedText = stripOscMarkers(text);
  }

  // Layer 2: Auto-detection (no OSC markers → try to find patterns)
  if (blocks.length === 0) {
    const lineMap = buildLineMap(text);

    detectDisplayLatex(text, lineMap, blocks);
    detectInlineLatex(text, lineMap, blocks);
    detectCodeBlocks(text, lineMap, blocks);
    detectTables(text, lineMap, blocks);

    // Sort blocks by their position in the text
    blocks.sort((a, b) => a.startLine - b.startLine);
  }

  return { blocks, cleanedText };
}

/**
 * Lightweight detection — only finds the FIRST block type in the buffer.
 * Suitable for debounced real-time scanning.
 */
export function detectFirstBlock(text: string): DetectedBlock | null {
  const cleanText = stripAnsi(text);
  // Check OSC markers first
  const oscMatch = OSC_AI_MARKER_RE.exec(cleanText);
  OSC_AI_MARKER_RE.lastIndex = 0;
  if (oscMatch) {
    return {
      type: oscMatch[1].toLowerCase() as RichContentType,
      content: oscMatch[3],
      language: oscMatch[2] || undefined,
      display: oscMatch[1] === 'LATEX' ? (oscMatch[2] as 'inline' | 'block') || 'block' : undefined,
      startLine: 0,
      endLine: 0,
    };
  }

  // Quick scan for display LaTeX
  const latexMatch = DISPLAY_LATEX_RE.exec(text);
  DISPLAY_LATEX_RE.lastIndex = 0;
  if (latexMatch) {
    return {
      type: 'latex',
      content: (latexMatch[1] || latexMatch[2]).trim(),
      display: 'block',
      startLine: 0,
      endLine: 0,
    };
  }

  // Quick scan for code block
  const codeMatch = CODE_BLOCK_RE.exec(text);
  CODE_BLOCK_RE.lastIndex = 0;
  if (codeMatch) {
    return {
      type: 'code',
      content: codeMatch[2],
      language: codeMatch[1] || undefined,
      startLine: 0,
      endLine: 0,
    };
  }

  return null;
}

// ── Internal Detectors ────────────────────────────────────────

function extractOscMarkers(text: string): DetectedBlock[] {
  const blocks: DetectedBlock[] = [];
  let match: RegExpExecArray | null;

  while ((match = OSC_AI_MARKER_RE.exec(text)) !== null) {
    const typeStr = match[1];
    const param = match[2];
    const content = match[3];

    let type: RichContentType;
    switch (typeStr) {
      case 'LATEX': type = 'latex'; break;
      case 'MARKDOWN': type = 'markdown'; break;
      case 'CODE': type = 'code'; break;
      case 'IMAGE': type = 'image'; break;
      default: continue;
    }

    blocks.push({
      type,
      content,
      language: typeStr === 'CODE' ? param : undefined,
      display: typeStr === 'LATEX' ? (param as 'inline' | 'block') || 'block' : undefined,
      startLine: countNewlines(text, 0, match.index),
      endLine: countNewlines(text, 0, match.index + match[0].length),
    });
  }

  return blocks;
}

function stripOscMarkers(text: string): string {
  return text.replace(OSC_AI_MARKER_RE, (_, __, ___, content) => content);
}

function detectDisplayLatex(text: string, lineMap: number[], blocks: DetectedBlock[]): void {
  let match: RegExpExecArray | null;
  while ((match = DISPLAY_LATEX_RE.exec(text)) !== null) {
    const content = (match[1] || match[2]).trim();
    blocks.push({
      type: 'latex',
      content,
      display: 'block',
      startLine: lineAt(lineMap, match.index),
      endLine: lineAt(lineMap, match.index + match[0].length),
    });
  }
}

function detectInlineLatex(text: string, lineMap: number[], blocks: DetectedBlock[]): void {
  let match: RegExpExecArray | null;
  while ((match = INLINE_LATEX_RE.exec(text)) !== null) {
    const content = (match[1] || match[2]).trim();
    // Skip false positives: must contain at least one letter or math symbol
    if (!/[a-zA-Z0-9\\{}(),.+\-*/=^_<>[\]]/.test(content)) continue;
    blocks.push({
      type: 'latex',
      content,
      display: 'inline',
      startLine: lineAt(lineMap, match.index),
      endLine: lineAt(lineMap, match.index + match[0].length),
    });
  }
}

function detectCodeBlocks(text: string, lineMap: number[], blocks: DetectedBlock[]): void {
  let match: RegExpExecArray | null;
  while ((match = CODE_BLOCK_RE.exec(text)) !== null) {
    const lang = match[1];
    const content = match[2];
    blocks.push({
      type: 'code',
      content,
      language: lang || undefined,
      startLine: lineAt(lineMap, match.index),
      endLine: lineAt(lineMap, match.index + match[0].length),
    });
  }
}

function detectTables(text: string, lineMap: number[], blocks: DetectedBlock[]): void {
  let match: RegExpExecArray | null;
  while ((match = TABLE_RE.exec(text)) !== null) {
    blocks.push({
      type: 'table',
      content: match[1].trim(),
      startLine: lineAt(lineMap, match.index),
      endLine: lineAt(lineMap, match.index + match[0].length),
    });
  }
}

// ── Line Tracking ─────────────────────────────────────────────

/** Build an array where lineMap[charIndex] = line number (0-based) */
function buildLineMap(text: string): number[] {
  const map: number[] = [];
  let line = 0;
  for (let i = 0; i < text.length; i++) {
    map[i] = line;
    if (text[i] === '\n') line++;
  }
  return map;
}

function lineAt(lineMap: number[], charIndex: number): number {
  if (charIndex >= lineMap.length) return lineMap[lineMap.length - 1] || 0;
  return lineMap[charIndex] || 0;
}

function countNewlines(text: string, start: number, end: number): number {
  let count = 0;
  for (let i = start; i < Math.min(end, text.length); i++) {
    if (text[i] === '\n') count++;
  }
  return count;
}
