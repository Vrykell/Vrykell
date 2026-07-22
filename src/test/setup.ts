import '@testing-library/jest-dom/vitest';

// jsdom does not implement scrollIntoView; stub it for terminal view tests.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom does not implement ResizeObserver; stub it for virtual scroll.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
