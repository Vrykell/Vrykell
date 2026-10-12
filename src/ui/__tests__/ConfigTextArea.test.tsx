import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ copy: vi.fn(), toast: vi.fn() }));
vi.mock('@platform/clipboard', () => ({ writeClipboardText: mocks.copy }));
vi.mock('@ui/Toast', () => ({ useToastStore: { getState: () => ({ addToast: mocks.toast }) } }));
import ConfigTextArea from '../ConfigTextArea';

beforeEach(() => { vi.clearAllMocks(); mocks.copy.mockResolvedValue(undefined); });
describe('configuration input copy', () => {
  it('copies the draft with confirmation and keeps editing and composition handlers', async () => {
    const change = vi.fn(); const compose = vi.fn();
    render(<ConfigTextArea aria-label="Rules" value={'8080:localhost:80\n1080'} onChange={change} onCompositionStart={compose} />);
    fireEvent.click(screen.getByRole('button', { name: '复制Rules' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '已复制' })).toBeVisible());
    expect(mocks.copy).toHaveBeenCalledWith('8080:localhost:80\n1080');
    fireEvent.compositionStart(screen.getByRole('textbox', { name: 'Rules' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Rules' }), { target: { value: 'updated' } });
    expect(compose).toHaveBeenCalled(); expect(change).toHaveBeenCalled();
  });
  it('reports clipboard failure without changing the draft', async () => {
    mocks.copy.mockRejectedValue(new Error('denied'));
    render(<ConfigTextArea aria-label="Rules" value="draft" readOnly />);
    fireEvent.click(screen.getByRole('button', { name: '复制Rules' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('复制失败，请选中文本手动复制。', 'error'));
    expect(screen.getByRole('textbox')).toHaveValue('draft');
  });
});
