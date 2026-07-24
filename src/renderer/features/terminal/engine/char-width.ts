// ── Character width measurement ──────────────────────────────────────────
// Hardcoding 8.4 px is inaccurate — Menlo 14 px renders at ~7.8–8.0 px
// depending on OS, browser, and subpixel rendering.  A 0.4 px error × 100
// columns = 40 px of wasted (or overflowing) space.  Measure once at boot.

let _charWidth = 0;

export function getCharWidth(): number {
  if (_charWidth > 0) return _charWidth;

  // Measure actual monospace character advance by rendering a 100-char
  // run of 'X' in a 1 s timeout guard — the measurement itself is instant
  // but we need a DOM context, so the first caller after mount wins.
  const el = document.createElement('span');
  el.style.cssText =
    'position:absolute;visibility:hidden;font-family:Menlo,monospace;font-size:14px;white-space:pre;';
  el.textContent = 'X'.repeat(100);
  document.body.appendChild(el);
  const measured = el.getBoundingClientRect().width / 100;
  document.body.removeChild(el);

  _charWidth = measured > 1 ? measured : 8.4; // fallback if measurement fails
  return _charWidth;
}
