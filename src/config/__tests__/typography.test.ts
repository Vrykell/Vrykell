import { beforeEach, describe, expect, it } from 'vitest';
import { boundedFontSize, boundedTerminalRenderer, terminalFontFamily, uiFontFamily, useTypographyStore } from '../typography';

describe('font preferences', () => {
  it('persists explicit native font choices separately from bundled defaults', async () => {
    useTypographyStore.getState().update({ uiFontPreset: 'system', terminalFontPreset: 'system-default', editorFontPreset: 'system-default' });
    await useTypographyStore.persist.rehydrate();
    expect(useTypographyStore.getState()).toMatchObject({ uiFontPreset: 'system', terminalFontPreset: 'system-default', editorFontPreset: 'system-default' });
    expect(uiFontFamily('system')).toMatch(/^system-ui,/);
    expect(uiFontFamily('system')).not.toContain('Noto Sans SC');
    expect(terminalFontFamily('system-default')).toMatch(/^monospace,/);
    expect(terminalFontFamily('system-default')).not.toContain('Maple Mono NF CN');
  });
  it('persists interface families, migrates older preferences and rejects unknown families', async () => {
    useTypographyStore.getState().update({ uiFontPreset: 'Inter' });
    await useTypographyStore.persist.rehydrate();
    expect(useTypographyStore.getState().uiFontPreset).toBe('Inter');
    expect(document.documentElement.style.getPropertyValue('--font-ui')).toMatch(/^"Inter",/);
    useTypographyStore.getState().update({ uiFontPreset: 'Maple Mono NF CN' });
    await useTypographyStore.persist.rehydrate();
    expect(useTypographyStore.getState().uiFontPreset).toBe('Maple Mono NF CN');
    expect(document.documentElement.style.getPropertyValue('--font-ui')).toMatch(/^"Maple Mono NF CN",/);
    for (const uiFontPreset of [undefined, 'Missing']) {
      localStorage.setItem('vrykell-typography', JSON.stringify({ version: 0, state: { uiFontPreset } }));
      await useTypographyStore.persist.rehydrate();
      expect(useTypographyStore.getState().uiFontPreset).toBe('Noto Sans SC');
    }
  });
  it('uses the bundled face by default and before generic fallbacks for custom fonts', () => {
    expect(terminalFontFamily('system')).toMatch(/^"Maple Mono NF CN",/);
    expect(terminalFontFamily('Maple Mono NF CN')).toBe(terminalFontFamily('system'));
    const custom = terminalFontFamily('JetBrains Mono');
    expect(custom).toMatch(/^"JetBrains Mono", "Maple Mono NF CN",/);
    expect(custom.indexOf('Maple Mono NF CN')).toBeLessThan(custom.indexOf('monospace'));
    expect(uiFontFamily('JetBrains Mono')).toBe(terminalFontFamily('JetBrains Mono'));
  });
  it('persists and validates editor metrics independently of terminal and chat metrics', async () => {
    useTypographyStore.getState().update({ editorFontSize: 18, editorFontPreset: 'Maple Mono', editorFontWeight: 550, editorLineHeight: 1.8 });
    await useTypographyStore.persist.rehydrate();
    expect(useTypographyStore.getState()).toMatchObject({ editorFontSize: 18, editorFontPreset: 'Maple Mono', editorFontWeight: 550, editorLineHeight: 1.8, terminalFontSize: 14, chatFontSize: 14 });
    localStorage.setItem('vrykell-typography', JSON.stringify({ version: 0, state: { editorFontSize: 999, editorFontPreset: 'missing', editorFontWeight: NaN, editorLineHeight: 99 } }));
    await useTypographyStore.persist.rehydrate();
    expect(useTypographyStore.getState()).toMatchObject({ editorFontSize: 24, editorFontPreset: 'system', editorFontWeight: 400, editorLineHeight: 2 });
  });
  beforeEach(() => {
    useTypographyStore.getState().reset();
    useTypographyStore.getState().update({ commandHighlighting: false, commandTitleCollapsed: false });
  });

  it('offers the installed CJK monospace presets in the family stack', () => {
    expect(terminalFontFamily('Sarasa Term SC')).toContain('"Sarasa Term SC"');
    expect(terminalFontFamily('NSimSun')).toContain('"NSimSun"');
  });

  it('defaults to steady cursors and persists both independent blink preferences', async () => {
    expect(useTypographyStore.getState()).toMatchObject({ terminalCursorBlink: false, compositionCursorBlink: false });
    expect(document.documentElement.style.getPropertyValue('--terminal-ime-cursor-animation')).toBe('none');
    useTypographyStore.getState().update({ terminalCursorBlink: true, compositionCursorBlink: true });
    await useTypographyStore.persist.rehydrate();
    expect(useTypographyStore.getState()).toMatchObject({ terminalCursorBlink: true, compositionCursorBlink: true });
    expect(document.documentElement.style.getPropertyValue('--terminal-ime-cursor-animation')).toBe('cursor-blink 1s step-end infinite');
    useTypographyStore.getState().update({ compositionCursorBlink: false });
    expect(useTypographyStore.getState().terminalCursorBlink).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--terminal-ime-cursor-animation')).toBe('none');
  });

  it('bounds and validates saved font sizes', () => {
    expect(boundedFontSize(30, 14)).toBe(24);
    expect(boundedFontSize(2, 14)).toBe(10);
    expect(boundedFontSize(NaN, 14)).toBe(14);
    expect(boundedFontSize('16', 14)).toBe(14);
  });

  it('updates independent UI and terminal metrics and saves them', () => {
    useTypographyStore.getState().update({ uiFontSize: 15, terminalFontSize: 18 });
    expect(document.documentElement.style.getPropertyValue('--terminal-font-size')).toBe('18px');
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

  it('persists the optional command highlighting and defaults old preferences to off', async () => {
    expect(useTypographyStore.getState().commandHighlighting).toBe(false);
    useTypographyStore.getState().update({ commandHighlighting: true });
    expect(JSON.parse(localStorage.getItem('vrykell-typography')!).state.commandHighlighting).toBe(true);
    await useTypographyStore.persist.rehydrate();
    expect(useTypographyStore.getState().commandHighlighting).toBe(true);
    useTypographyStore.getState().reset();
    expect(useTypographyStore.getState().commandHighlighting).toBe(true);
    localStorage.setItem('vrykell-typography', JSON.stringify({ version: 0, state: { commandHighlighting: 'true' } }));
    await useTypographyStore.persist.rehydrate();
    expect(useTypographyStore.getState().commandHighlighting).toBe(false);
  });

  it('remembers the collapsed viewport title across launches and keeps it on reset', async () => {
    expect(useTypographyStore.getState().commandTitleCollapsed).toBe(false);
    useTypographyStore.getState().update({ commandTitleCollapsed: true });
    expect(JSON.parse(localStorage.getItem('vrykell-typography')!).state.commandTitleCollapsed).toBe(true);
    await useTypographyStore.persist.rehydrate();
    expect(useTypographyStore.getState().commandTitleCollapsed).toBe(true);
    useTypographyStore.getState().reset();
    expect(useTypographyStore.getState().commandTitleCollapsed).toBe(true);
    localStorage.setItem('vrykell-typography', JSON.stringify({ version: 0, state: { commandTitleCollapsed: 'yes' } }));
    await useTypographyStore.persist.rehydrate();
    expect(useTypographyStore.getState().commandTitleCollapsed).toBe(false);
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
  expect(JSON.parse(localStorage.getItem('vrykell-typography')!).state).toMatchObject({ terminalFontPreset: 'Maple Mono NF CN', terminalFontWeight: 350, terminalLineHeight: 1.2 });
  localStorage.setItem('vrykell-typography', JSON.stringify({ version: 0, state: { terminalFontPreset: 'unknown', terminalFontWeight: 10000, terminalLineHeight: 'bad' } }));
  await useTypographyStore.persist.rehydrate();
  expect(useTypographyStore.getState()).toMatchObject({ terminalFontPreset: 'system', terminalFontWeight: 900, terminalLineHeight: 1 });
  useTypographyStore.getState().reset();
  expect(useTypographyStore.getState()).toMatchObject({ terminalFontPreset: 'system', terminalFontWeight: 400, terminalLineHeight: 1 });
});
