import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import FontSettings from '../components/FontSettings';
import { useTypographyStore } from '@config/typography';

describe('theme font settings', () => {
  beforeEach(() => useTypographyStore.getState().reset());
  it('updates global page and terminal fonts independently and restores defaults', () => {
    render(<FontSettings />);
    fireEvent.click(screen.getByRole('combobox', { name: '页面字号' }));
    fireEvent.click(screen.getByRole('option', { name: '15px' }));
    expect(useTypographyStore.getState()).toMatchObject({ uiFontSize: 15, terminalFontSize: 14 });
    fireEvent.click(screen.getByRole('combobox', { name: '终端字号' }));
    fireEvent.click(screen.getByRole('option', { name: '16px' }));
    expect(useTypographyStore.getState()).toMatchObject({ uiFontSize: 15, terminalFontSize: 16 });
    fireEvent.click(screen.getByRole('button', { name: '恢复默认字号' }));
    expect(useTypographyStore.getState()).toMatchObject({ uiFontSize: 13, terminalFontSize: 14 });
  });

  it('switches the terminal renderer and restores WebGL by default', () => {
    render(<FontSettings />);
    expect(useTypographyStore.getState().terminalRenderer).toBe('webgl');
    fireEvent.click(screen.getByRole('combobox', { name: '终端渲染器' }));
    fireEvent.click(screen.getByRole('option', { name: 'DOM（边缘更干净）' }));
    expect(useTypographyStore.getState().terminalRenderer).toBe('dom');
    fireEvent.click(screen.getByRole('button', { name: '恢复默认字号' }));
    expect(useTypographyStore.getState().terminalRenderer).toBe('webgl');
  });
});
