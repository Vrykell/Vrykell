import '@testing-library/jest-dom/vitest';

// jsdom does not implement scrollIntoView; stub it for terminal view tests.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
