import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';
import { useWorkbenchStore } from '@features/workspace/stores/workbench';
import { emptyWorkbench } from '@features/workspace/model/workbench';

beforeEach(() => { useWorkbenchStore.setState({ snapshot: emptyWorkbench(), ready: true, lastClosed: null }); });

// xterm.js needs matchMedia (not available in jsdom)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// xterm.js needs canvas (not available in jsdom).
// Provide a minimal mock so new Terminal(...).open(el) doesn't throw.
const noop = () => {};
const mockCtx = {
  measureText: (s: string) => ({ width: s.length * 8 }),
  fillText: noop, strokeText: noop, fillRect: noop, clearRect: noop,
  strokeRect: noop, beginPath: noop, closePath: noop, moveTo: noop,
  lineTo: noop, arc: noop, arcTo: noop, bezierCurveTo: noop,
  quadraticCurveTo: noop, rect: noop, clip: noop, save: noop,
  restore: noop, scale: noop, translate: noop, rotate: noop,
  transform: noop, setTransform: noop, resetTransform: noop,
  createLinearGradient: () => ({ addColorStop: noop }),
  createRadialGradient: () => ({ addColorStop: noop }),
  createPattern: () => ({}),
  drawImage: noop, putImageData: noop, getImageData: () => ({ data: new Uint8ClampedArray() }),
  createImageData: () => ({ data: new Uint8ClampedArray() }),
  getContextAttributes: () => ({}),
  isPointInPath: () => false, isPointInStroke: () => false,
  getLineDash: () => [], setLineDash: noop,
  createConicGradient: () => ({ addColorStop: noop }),
  roundRect: noop,
  // Properties xterm.js may set/read
  font: '', textBaseline: 'alphabetic', textAlign: 'start',
  fillStyle: '', strokeStyle: '', globalAlpha: 1,
  lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
  miterLimit: 10, shadowBlur: 0, shadowColor: 'transparent',
  shadowOffsetX: 0, shadowOffsetY: 0,
  globalCompositeOperation: 'source-over',
  filter: 'none', imageSmoothingEnabled: true,
} as unknown as CanvasRenderingContext2D;

const origGetContext = HTMLCanvasElement.prototype.getContext;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(HTMLCanvasElement.prototype as any).getContext = function (
  contextId: string,
  ...args: unknown[]
) {
  if (contextId === '2d') return mockCtx;
  return origGetContext.call(this, contextId, ...args);
};
