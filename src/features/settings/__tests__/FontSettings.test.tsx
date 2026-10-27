import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import FontSettings from '../components/FontSettings';
import { useTypographyStore } from '@config/typography';

describe('theme font settings', () => {
  it('also offers terminal font families for the interface without changing content fonts', () => {
    render(<FontSettings />);
    fireEvent.click(screen.getByRole('combobox', { name: '页面字体' }));
    expect(screen.getByRole('option', { name: 'Cascadia Code' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'JetBrains Mono' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'Maple Mono NF CN' }));
    expect(document.documentElement.style.getPropertyValue('--font-ui')).toMatch(/^"Maple Mono NF CN",/);
    expect(useTypographyStore.getState()).toMatchObject({ uiFontPreset: 'Maple Mono NF CN', terminalFontPreset: 'system', editorFontPreset: 'system' });
  });
  it('offers native defaults for the interface, terminal and editor independently', () => {
    render(<FontSettings />);
    for (const name of ['页面字体', '终端字体', '编辑器字体']) {
      fireEvent.click(screen.getByRole('combobox', { name }));
      fireEvent.click(screen.getByRole('option', { name: '系统默认字体' }));
      expect(screen.getByRole('combobox', { name })).toHaveTextContent('系统默认字体');
    }
    expect(useTypographyStore.getState()).toMatchObject({ uiFontPreset: 'system', terminalFontPreset: 'system-default', editorFontPreset: 'system-default' });
    expect(document.documentElement.style.getPropertyValue('--font-ui')).toMatch(/^system-ui,/);
    expect(document.documentElement.style.getPropertyValue('--terminal-font-family')).toMatch(/^monospace,/);
    expect(document.documentElement.style.getPropertyValue('--editor-font-family')).toMatch(/^monospace,/);
  });
  it('offers plain font names, hides unavailable faces and changes the interface independently', async () => {
    render(<FontSettings />);
    fireEvent.click(screen.getByRole('combobox', { name: '页面字体' }));
    fireEvent.click(screen.getByRole('option', { name: 'Inter' }));
    expect(useTypographyStore.getState()).toMatchObject({ uiFontPreset: 'Inter', terminalFontPreset: 'system', editorFontPreset: 'system' });
    expect(document.documentElement.style.getPropertyValue('--font-ui')).toMatch(/^"Inter",/);
    fireEvent.click(screen.getByRole('combobox', { name: '终端字体' }));
    await waitFor(() => expect(screen.queryByRole('option', { name: 'Sarasa Term SC' })).toBeNull());
    expect(screen.getByRole('option', { name: 'Maple Mono NF CN' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Cascadia Code' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'JetBrains Mono' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /[（）]/ })).toBeNull();
  });
  beforeEach(() => { useTypographyStore.getState().reset(); useTypographyStore.getState().update({ commandHighlighting: false }); });
  it('updates global page and terminal fonts independently and restores defaults', () => {
    render(<FontSettings />);
    fireEvent.click(screen.getByRole('combobox', { name: '页面字号' }));
    fireEvent.click(screen.getByRole('option', { name: '15px' }));
    expect(useTypographyStore.getState()).toMatchObject({ uiFontSize: 15, terminalFontSize: 14 });
    fireEvent.click(screen.getByRole('combobox', { name: '终端字号' }));
    fireEvent.click(screen.getByRole('option', { name: '16px' }));
    expect(useTypographyStore.getState()).toMatchObject({ uiFontSize: 15, terminalFontSize: 16 });
    fireEvent.click(screen.getByRole('button', { name: '恢复默认字体设置' }));
    expect(useTypographyStore.getState()).toMatchObject({ uiFontSize: 13, terminalFontSize: 14 });
  });

  it('switches the terminal renderer and restores WebGL by default', () => {
    render(<FontSettings />);
    expect(useTypographyStore.getState().terminalRenderer).toBe('webgl');
    fireEvent.click(screen.getByRole('combobox', { name: '终端渲染器' }));
    fireEvent.click(screen.getByRole('option', { name: 'DOM（边缘更干净）' }));
    expect(useTypographyStore.getState().terminalRenderer).toBe('dom');
    fireEvent.click(screen.getByRole('button', { name: '恢复默认字体设置' }));
    expect(useTypographyStore.getState().terminalRenderer).toBe('webgl');
  });

  it('keeps terminal and composition cursor blinking independently configurable', async () => {
    render(<FontSettings />);
    const terminal = screen.getByRole('switch', { name: '终端光标闪烁' });
    const composition = screen.getByRole('switch', { name: '输入法光标闪烁' });
    expect(terminal).toHaveAttribute('aria-checked', 'false');
    expect(composition).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(terminal);
    await waitFor(() => expect(useTypographyStore.getState().terminalCursorBlink).toBe(true));
    expect(useTypographyStore.getState().compositionCursorBlink).toBe(false);
    fireEvent.click(composition);
    await waitFor(() => expect(useTypographyStore.getState().compositionCursorBlink).toBe(true));
  });

  it('toggles command syntax highlighting without the font reset clearing it', async () => {
    render(<FontSettings />);
    const toggle = screen.getByRole('switch', { name: '命令语法高亮' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    await waitFor(() => expect(useTypographyStore.getState().commandHighlighting).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: '恢复默认字体设置' }));
    expect(useTypographyStore.getState().commandHighlighting).toBe(true);
    fireEvent.click(toggle);
    await waitFor(() => expect(useTypographyStore.getState().commandHighlighting).toBe(false));
  });
});

it('previews font family, weight and line spacing and restores them together', () => {
  render(<FontSettings />);
  expect(screen.getByRole('combobox', { name: '终端字体' })).toHaveTextContent('Maple Mono NF CN');
  for (const [name, option] of [['终端字体', 'Cascadia Code'], ['终端字重', '350'], ['终端行距', '1.2×']]) {
    fireEvent.click(screen.getByRole('combobox', { name }));
    fireEvent.click(screen.getByRole('option', { name: option }));
  }
  expect(useTypographyStore.getState()).toMatchObject({ terminalFontPreset: 'Cascadia Code', terminalFontWeight: 350, terminalLineHeight: 1.2 });
  expect(screen.getByLabelText('终端字体预览')).toHaveTextContent('AaBb 0123');
  fireEvent.click(screen.getByRole('button', { name: '恢复默认字体设置' }));
  expect(useTypographyStore.getState()).toMatchObject({ terminalFontPreset: 'system', terminalFontWeight: 400, terminalLineHeight: 1 });
});
