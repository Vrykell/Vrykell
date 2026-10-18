import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import FontSettings from '../components/FontSettings';
import { useTypographyStore } from '@config/typography';

describe('theme font settings', () => {
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
  for (const [name, option] of [['终端字体', 'Maple Mono NF CN'], ['终端字重', '350'], ['终端行距', '1.2×']]) {
    fireEvent.click(screen.getByRole('combobox', { name }));
    fireEvent.click(screen.getByRole('option', { name: option }));
  }
  expect(useTypographyStore.getState()).toMatchObject({ terminalFontPreset: 'Maple Mono NF CN', terminalFontWeight: 350, terminalLineHeight: 1.2 });
  expect(screen.getByLabelText('终端字体预览')).toHaveTextContent('AaBb 0123');
  fireEvent.click(screen.getByRole('button', { name: '恢复默认字体设置' }));
  expect(useTypographyStore.getState()).toMatchObject({ terminalFontPreset: 'system', terminalFontWeight: 400, terminalLineHeight: 1 });
});
