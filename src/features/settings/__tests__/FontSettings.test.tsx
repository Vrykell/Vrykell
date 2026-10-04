import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import FontSettings from '../components/FontSettings';
import { useTypographyStore } from '@config/typography';

describe('theme font settings', () => {
  beforeEach(() => useTypographyStore.getState().reset());
  it('updates global page and terminal fonts independently and restores defaults', () => {
    render(<FontSettings />);
    fireEvent.change(screen.getByLabelText('页面字号'), { target: { value: '15' } });
    expect(useTypographyStore.getState()).toMatchObject({ uiFontSize: 15, terminalFontSize: 14 });
    fireEvent.change(screen.getByLabelText('终端字号'), { target: { value: '16' } });
    expect(useTypographyStore.getState()).toMatchObject({ uiFontSize: 15, terminalFontSize: 16 });
    fireEvent.click(screen.getByRole('button', { name: '恢复默认字号' }));
    expect(useTypographyStore.getState()).toMatchObject({ uiFontSize: 13, terminalFontSize: 14 });
  });
});
