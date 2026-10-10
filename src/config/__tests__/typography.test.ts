import { beforeEach, describe, expect, it } from 'vitest';
import { boundedFontSize, boundedTerminalRenderer, useTypographyStore } from '../typography';

describe('font preferences', () => {
  beforeEach(() => useTypographyStore.getState().reset());

  it('bounds and validates saved font sizes', () => {
    expect(boundedFontSize(30, 14)).toBe(24);
    expect(boundedFontSize(2, 14)).toBe(10);
    expect(boundedFontSize(NaN, 14)).toBe(14);
    expect(boundedFontSize('16', 14)).toBe(14);
  });

  it('updates independent UI and terminal metrics and saves them', () => {
    useTypographyStore.getState().update({ uiFontSize: 15, terminalFontSize: 18 });
    expect(document.documentElement.style.getPropertyValue('--terminal-font-size')).toBe('18px');
    expect(document.documentElement.style.getPropertyValue('--terminal-row-height')).toBe('21px');
    expect(document.documentElement.style.getPropertyValue('--ui-font-scale')).toBe(String(15 / 13));
    expect(JSON.parse(localStorage.getItem('vrykell-typography')!).state).toMatchObject({ uiFontSize: 15, terminalFontSize: 18, terminalRenderer: 'webgl' });
  });

  it('keeps the renderer preference and rejects unknown values', async () => {
    expect(boundedTerminalRenderer('dom', 'webgl')).toBe('dom');
    expect(boundedTerminalRenderer('vulkan', 'webgl')).toBe('webgl');
    useTypographyStore.getState().update({ terminalRenderer: 'dom' });
    expect(JSON.parse(localStorage.getItem('vrykell-typography')!).state.terminalRenderer).toBe('dom');
    localStorage.setItem('vrykell-typography', JSON.stringify({ version: 0, state: { terminalRenderer: 'vulkan' } }));
    await useTypographyStore.persist.rehydrate();
    expect(useTypographyStore.getState().terminalRenderer).toBe('webgl');
  });

  it('restores and validates persisted sizes without replacing store actions', async () => {
    localStorage.setItem('vrykell-typography', JSON.stringify({ version: 0, state: { uiFontSize: 999, terminalFontSize: 20 } }));
    await useTypographyStore.persist.rehydrate();
    expect(useTypographyStore.getState().uiFontSize).toBe(18);
    expect(useTypographyStore.getState().terminalFontSize).toBe(20);
    useTypographyStore.getState().reset();
    expect(useTypographyStore.getState().terminalFontSize).toBe(14);
  });
});

it('validates font preferences, migrates older settings and resets all metrics', async () => {
  useTypographyStore.getState().update({ terminalFontPreset: 'Maple Mono NF CN', terminalFontWeight: 350, terminalLineHeight: 1.2 });
  expect(document.documentElement.style.getPropertyValue('--terminal-font-family')).toContain('"Maple Mono NF CN"');
  expect(document.documentElement.style.getPropertyValue('--terminal-font-weight')).toBe('350');
  expect(document.documentElement.style.getPropertyValue('--terminal-row-height')).toBe('20px');
  expect(JSON.parse(localStorage.getItem('vrykell-typography')!).state).toMatchObject({ terminalFontPreset: 'Maple Mono NF CN', terminalFontWeight: 350, terminalLineHeight: 1.2 });
  localStorage.setItem('vrykell-typography', JSON.stringify({ version: 0, state: { terminalFontPreset: 'unknown', terminalFontWeight: 10000, terminalLineHeight: 'bad' } }));
  await useTypographyStore.persist.rehydrate();
  expect(useTypographyStore.getState()).toMatchObject({ terminalFontPreset: 'system', terminalFontWeight: 900, terminalLineHeight: 1 });
  useTypographyStore.getState().reset();
  expect(useTypographyStore.getState()).toMatchObject({ terminalFontPreset: 'system', terminalFontWeight: 400, terminalLineHeight: 1 });
});
