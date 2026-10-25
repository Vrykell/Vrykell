import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import FilePanel from '../components/FilePanel';

vi.mock('@platform/api/fs', async () => ({
  ...await vi.importActual<typeof import('@platform/api/fs')>('@platform/api/fs'),
  fsHome: vi.fn().mockResolvedValue('/work'),
  fsDisks: vi.fn().mockResolvedValue([]),
  fsList: vi.fn().mockResolvedValue([{ name: 'notes.txt', path: '/work/notes.txt', is_dir: false }]),
}));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());

describe('file panel rename fields', () => {
  async function rename() {
    render(<FilePanel target={{ kind: 'local' }} initialPath="/work" openEntry={vi.fn()} />);
    fireEvent.contextMenu(await screen.findByText('notes.txt'));
    fireEvent.click(await screen.findByRole('button', { name: '重命名' }));
    return screen.getByRole('textbox', { name: '文件名' });
  }

  it('reuses the shared rename field and cancels without changing the name', async () => {
    const input = await rename();
    expect(input).toHaveClass('text-input-field', 'inline-rename-input');
    expect(input.parentElement).toHaveClass('inline-rename-fit');
    fireEvent.change(input, { target: { value: 'a longer filename.txt' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('rename-input')).not.toBeInTheDocument();
    expect(screen.getByText('notes.txt')).toBeVisible();
  });

  it('does not submit while composing and opens only one confirmation on Enter', async () => {
    const input = await rename();
    fireEvent.change(input, { target: { value: 'renamed.txt' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(await screen.findAllByRole('dialog')).toHaveLength(1);
  });
});
