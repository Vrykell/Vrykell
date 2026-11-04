import { useEffect, type RefObject } from 'react';

/**
 * A thicker insertion point for the application's text fields.
 *
 * The rendering engine paints the native caret one pixel wide and no CSS property changes that
 * width, so an opted-in field makes its own caret transparent and this module paints a bar in the
 * theme's caret colour over it. One overlay serves the whole application because only the focused
 * field has an insertion point.
 *
 * A hidden mirror next to the body reproduces the field's typography, box and scroll offset, which
 * is the only way to learn where the caret sits inside a text control: neither API exposes the
 * caret rectangle. The mirror is removed from view with `visibility`, never with `display`, so its
 * layout stays measurable while it is off screen.
 */

type Field = HTMLInputElement | HTMLTextAreaElement;

/** Geometry the mirror must share with the field, or the caret lands on the wrong glyph. */
const MIRROR_PROPERTIES = [
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
  'letter-spacing', 'word-spacing', 'line-height', 'text-align', 'text-indent',
  'text-transform', 'white-space', 'overflow-wrap', 'word-break', 'tab-size', 'direction',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
];

/** Everything a user can move the insertion point with, plus the events a scroll can arrive on. */
const REFRESH_EVENTS = ['input', 'keyup', 'mouseup', 'click', 'select', 'scroll', 'compositionupdate', 'compositionend'];

const fields = new WeakSet<Field>();
let active: Field | null = null;
let overlay: HTMLDivElement | null = null;
let mirror: HTMLDivElement | null = null;
let listening = false;
let sizes: ResizeObserver | null = null;

/** A field that grows or moves must move its caret with it, so its box is observed while painted. */
function watchSize(field: Field): void {
  if (typeof ResizeObserver === 'undefined') return;
  sizes ??= new ResizeObserver(() => refresh());
  sizes.observe(field);
}

function ensureOverlay(): HTMLDivElement {
  if (!overlay?.isConnected) {
    overlay = document.createElement('div');
    overlay.className = 'text-caret';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.hidden = true;
    document.body.appendChild(overlay);
  }
  return overlay;
}

function ensureMirror(): HTMLDivElement {
  if (!mirror?.isConnected) {
    mirror = document.createElement('div');
    mirror.className = 'text-caret-mirror';
    mirror.setAttribute('aria-hidden', 'true');
    document.body.appendChild(mirror);
  }
  return mirror;
}

/** Selection bounds, or null for a field that does not expose them (number, email, date). */
function boundsOf(field: Field): { start: number; end: number } | null {
  try {
    const start = field.selectionStart;
    const end = field.selectionEnd;
    return start === null || end === null ? null : { start, end };
  } catch {
    return null;
  }
}

/**
 * Where the collapsed caret sits, in viewport pixels, or null when the field has no caret to draw:
 * no selection support, a range selection, or zero size (hidden or not laid out yet).
 */
function caretRect(field: Field): { left: number; top: number; height: number } | null {
  const bounds = boundsOf(field);
  if (!bounds || bounds.start !== bounds.end) return null;
  const box = field.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
  const style = getComputedStyle(field);
  const area = ensureMirror();
  area.style.cssText = MIRROR_PROPERTIES.map(name => `${name}:${style.getPropertyValue(name)}`).join(';');
  area.style.position = 'fixed';
  area.style.margin = '0';
  area.style.boxSizing = 'border-box';
  area.style.visibility = 'hidden';
  area.style.overflow = 'hidden';
  area.style.pointerEvents = 'none';
  area.style.left = `${box.left}px`;
  area.style.top = `${box.top}px`;
  area.style.width = `${box.width}px`;
  area.style.height = `${box.height}px`;
  if (field instanceof HTMLInputElement) area.style.whiteSpace = 'pre';
  // A password field is mirrored as its bullets: the measurement must never put the plaintext into
  // the document, where a later script or the accessibility tree could read it.
  const text = field.type === 'password' ? '•'.repeat(field.value.length) : field.value;
  area.textContent = text.slice(0, bounds.start);
  // The remainder keeps wrapping identical to the real field; an empty remainder would collapse
  // the marker at a trailing newline, so it holds one zero-width character.
  const marker = document.createElement('span');
  marker.textContent = text.slice(bounds.start) || '\u200b';
  area.appendChild(marker);
  area.scrollLeft = field.scrollLeft;
  area.scrollTop = field.scrollTop;
  const mark = marker.getClientRects()[0] ?? marker.getBoundingClientRect();
  const lineHeight = mark.height || Number.parseFloat(style.lineHeight) || box.height;
  const top = mark.top + 1;
  const bottom = top + Math.max(lineHeight - 2, 6);
  let clipLeft = Math.max(box.left, 0);
  let clipRight = Math.min(box.right, window.innerWidth);
  let clipTop = Math.max(box.top, 0);
  let clipBottom = Math.min(box.bottom, window.innerHeight);
  for (let parent = field.parentElement; parent; parent = parent.parentElement) {
    const parentStyle = getComputedStyle(parent);
    const clipsX = /^(auto|scroll|hidden|clip)$/.test(parentStyle.overflowX);
    const clipsY = /^(auto|scroll|hidden|clip)$/.test(parentStyle.overflowY);
    if (!clipsX && !clipsY) continue;
    const parentBox = parent.getBoundingClientRect();
    if (clipsX) { clipLeft = Math.max(clipLeft, parentBox.left); clipRight = Math.min(clipRight, parentBox.right); }
    if (clipsY) { clipTop = Math.max(clipTop, parentBox.top); clipBottom = Math.min(clipBottom, parentBox.bottom); }
  }
  if (mark.left < clipLeft || mark.left >= clipRight || bottom <= clipTop || top >= clipBottom) return null;
  return { left: mark.left, top: Math.max(top, clipTop), height: Math.min(bottom, clipBottom) - Math.max(top, clipTop) };
}

/** Draw the caret for `field`, or drop it when the field has none to draw. */
function paint(field: Field): void {
  const rect = caretRect(field);
  const bar = ensureOverlay();
  if (!rect) {
    bar.hidden = true;
    field.classList.remove('text-caret-field');
    sizes?.unobserve(field);
    if (active === field) active = null;
    if (mirror) mirror.textContent = '';
    return;
  }
  active = field;
  field.classList.add('text-caret-field');
  watchSize(field);
  bar.style.left = `${rect.left}px`;
  bar.style.top = `${rect.top}px`;
  bar.style.height = `${rect.height}px`;
  bar.hidden = false;
}

function hide(): void {
  if (active) sizes?.unobserve(active);
  active?.classList.remove('text-caret-field');
  active = null;
  if (overlay) overlay.hidden = true;
  // The mirror copies field text (masked for passwords); drop it rather than leave it in the page.
  if (mirror) mirror.textContent = '';
}

function onFocus(): void {
  refresh();
}

function onBlur(event: Event): void {
  if (event.target === active) hide();
}

/** Re-derive from the focused field: the caret may have moved, or a range selection replaced it. */
function refresh(): void {
  const field = document.activeElement as Field | null;
  if (field && fields.has(field)) paint(field);
  else hide();
}

function install(): void {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  // `focus` and `blur` do not bubble, so they are captured; the field list decides what qualifies.
  document.addEventListener('focus', onFocus, true);
  document.addEventListener('blur', onBlur, true);
  document.addEventListener('selectionchange', refresh);
  for (const type of REFRESH_EVENTS) document.addEventListener(type, refresh, true);
  window.addEventListener('resize', refresh);
}

/** Opt a text field into the shared caret. `enabled` false keeps the native insertion point. */
export function useBoldCaret(ref: RefObject<Field | null>, enabled = true): void {
  useEffect(() => {
    const field = ref.current;
    if (!enabled || !field) return;
    fields.add(field);
    install();
    if (document.activeElement === field) paint(field);
    return () => {
      fields.delete(field);
      field.classList.remove('text-caret-field');
      if (active === field) hide();
    };
  }, [ref, enabled]);
}
