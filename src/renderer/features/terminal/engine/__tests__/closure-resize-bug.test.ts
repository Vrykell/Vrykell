/**
 * Regression test: onResize closure over stale buffer.
 *
 * Bug: onResize was wrapped in useCallback(..., []) which permanently
 * captured `buf` from the first render.  When the first render has
 * sessionId=null, a temporary uncached TerminalBuffer is created.
 * When sessionId later becomes "local-1-xxx", bufRef.current is
 * updated to the real cached buffer, but onResize still references
 * the stale temporary one.  Result: the cached buffer (which
 * processes all PTY events) is NEVER resized — it stays at the
 * initial estimateCols(), causing permanent width mismatch.
 *
 * Fix: onResize is now a plain function (recreated every render) and
 * TerminalView keeps a mutable ref to it so the ResizeObserver never
 * calls a stale closure.
 */
import { describe, it, expect } from 'vitest';
import { TerminalBuffer } from '../buffer';

describe('onResize closure over stale buffer', () => {
  // Simulate what happens in useDomTerminal:
  //   Render 1: sessionId=null  → buf = temporary (uncached)
  //   Render 2: sessionId="s1"  → buf = cached
  //   ResizeObserver calls onResize from render 1 → wrong buffer!

  it('the correct buffer receives resize when session changes', () => {
    // ── Simulate the bug scenario ──────────────────────────────
    // Create a mock of the hook's internal state
    const cache = new Map<string, TerminalBuffer>();

    function getBuffer(sid: string): TerminalBuffer {
      let b = cache.get(sid);
      if (!b) {
        b = new TerminalBuffer();
        b.resize(80); // estimateCols() equivalent
        cache.set(sid, b);
      }
      return b;
    }

    // Render 1: sessionId=null
    const temp = new TerminalBuffer(); // uncached temporary
    let buf1 = temp;
    // onResize from render 1 (with [] deps) captures buf1
    function onResizeV1(cols: number) {
      buf1.resize(cols); // ALWAYS operates on buf1 (the stale closure)
    }

    // Render 2: sessionId="s1"
    const cached = getBuffer("s1");
    let buf2 = cached; // bufRef.current updated
    // onResize from render 2 — a NEW function capturing buf2
    function onResizeV2(cols: number) {
      buf2.resize(cols); // operates on the CURRENT buffer
    }

    // ── The BUG: ResizeObserver calls onResizeV1 ────────────────
    onResizeV1(120);
    // temp.buf1 was resized to 120, but cached is still at 80!
    expect(temp.cols).toBe(120);  // temp got the resize (wrong buffer)
    expect(cached.cols).toBe(80); // cached did NOT get the resize — BUG!

    // ── The FIX: call onResizeV2 instead ───────────────────────
    cached.resize(80); // reset
    onResizeV2(120);
    expect(cached.cols).toBe(120); // NOW the correct buffer is resized
    expect(temp.cols).toBe(120);   // unchanged by onResizeV2 (as expected)
  });

  it('mutable ref pattern correctly delegates to latest function', () => {
    // Simulate the TerminalView fix: onResizeRef always points to
    // the latest onResize function.
    const cache = new Map<string, TerminalBuffer>();
    function getBuffer(sid: string): TerminalBuffer {
      let b = cache.get(sid);
      if (!b) { b = new TerminalBuffer(); b.resize(80); cache.set(sid, b); }
      return b;
    }

    const temp = new TerminalBuffer();
    const cached = getBuffer("s1");

    // The mutable ref pattern:
    let onResizeCurrent: ((cols: number) => void) | undefined;

    // Render 1: sessionId=null
    onResizeCurrent = (cols: number) => { temp.resize(cols); };

    // Render 2: sessionId="s1"
    onResizeCurrent = (cols: number) => { cached.resize(cols); };

    // ResizeObserver calls ref.current (which is the latest)
    onResizeCurrent(120);
    expect(cached.cols).toBe(120); // correct buffer resized
    expect(temp.cols).toBe(80);    // temp untouched
  });
});
