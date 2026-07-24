import { useEffect, useRef } from 'react';
import { useTerminalStore } from '../../../../stores/terminal-store';
import { detectRichContent } from '../../pipeline/detector';
import { RichOutputItem, DetectedBlock } from '../../../../../shared/types/index';
import { onPTYOutput } from '../../../../../api';

const DETECTION_DEBOUNCE_MS = 300;
const MAX_BUFFER_SIZE = 50000; // ~50KB of text before trimming

/**
 * Hook that monitors PTY output for a session, buffers the output,
 * and detects rich content (LaTeX, Markdown, code blocks, tables).
 * Detected content is pushed to the Zustand richOutputs store.
 */
export function useRichContent(sessionId: string | null): void {
  const bufferRef = useRef<Record<string, string>>({});
  const timerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const seenRef = useRef<Set<string>>(new Set()); // dedup by content hash

  const appendOutput = useTerminalStore((s) => s.appendOutput);

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    onPTYOutput(({ sessionId: sid, events }) => {
      if (!sessionId || sid !== sessionId) return;

      // Collect text from structured events (the Rust parser already stripped ANSI).
      const text = events
        .filter((ev: { t: string }) => ev.t === 'txt')
        .map((ev: { p?: string }) => ev.p ?? '')
        .join('');

      // Append to buffer
      if (!bufferRef.current[sid]) {
        bufferRef.current[sid] = '';
      }
      bufferRef.current[sid] += text;

      // Trim if buffer gets too large
      if (bufferRef.current[sid].length > MAX_BUFFER_SIZE) {
        bufferRef.current[sid] = bufferRef.current[sid].slice(-MAX_BUFFER_SIZE / 2);
      }

      // Debounce detection
      if (timerRef.current[sid]) {
        clearTimeout(timerRef.current[sid]);
      }
      timerRef.current[sid] = setTimeout(() => {
        processBuffer(sid);
      }, DETECTION_DEBOUNCE_MS);
    }).then(fn => { unlisten = fn; });

    return () => { unlisten?.();
      // Clear timers
      Object.values(timerRef.current).forEach(clearTimeout);
      timerRef.current = {};
    };
  }, [sessionId, appendOutput]);

  function processBuffer(sid: string): void {
    const text = bufferRef.current[sid];
    if (!text || text.length < 4) return;

    const { blocks, cleanedText } = detectRichContent(text);

    if (blocks.length === 0) return;

    for (const block of blocks) {
      const hash = simpleHash(block.type + block.content.slice(0, 100));
      if (seenRef.current.has(hash)) continue;
      seenRef.current.add(hash);

      const item: RichOutputItem = {
        id: `${sid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        sessionId: sid,
        type: block.type,
        content: block.content,
        language: block.language,
        display: block.display,
        timestamp: Date.now(),
      };

      appendOutput(sid, item);
    }

    // If we found OSC markers, replace buffer with cleaned text
    // so we don't re-detect the same markers
    if (cleanedText !== text) {
      bufferRef.current[sid] = cleanedText;
    }

    // Limit seen set size
    if (seenRef.current.size > 500) {
      const entries = [...seenRef.current];
      seenRef.current = new Set(entries.slice(-250));
    }
  }
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return hash.toString(36);
}
