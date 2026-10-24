import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CodeDiff from '@ui/editor/CodeDiff';

const mocks = vi.hoisted(() => ({
  dispose: vi.fn(), modelDispose: vi.fn(), create: vi.fn(), createModel: vi.fn(),
  update: vi.fn(), labels: vi.fn(), theme: vi.fn(), language: vi.fn(),
}));
vi.mock('@ui/editor/code/runtime', () => ({
  applyCodeTheme: mocks.theme,
  languageForFile: () => 'typescript',
  editorApi: { editor: { createDiffEditor: mocks.create, createModel: mocks.createModel, setModelLanguage: mocks.language } },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1000, height: 600, x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 600, toJSON: () => ({}) });
  mocks.create.mockImplementation(() => ({
    setModel: vi.fn(), updateOptions: mocks.update, saveViewState: () => null, restoreViewState: vi.fn(),
    getOriginalEditor: () => ({ updateOptions: mocks.labels }), getModifiedEditor: () => ({ updateOptions: mocks.labels }),
    goToDiff: vi.fn(), dispose: mocks.dispose, layout: vi.fn(),
  }));
  mocks.createModel.mockImplementation(() => {
    let value = '';
    return { getValue: () => value, setValue: (next: string) => { value = next; }, dispose: mocks.modelDispose };
  });
});

describe('comparison lifecycle', () => {
  it('puts change navigation into the supplied toolbar without a duplicate inline heading', async () => {
    const { container } = render(<CodeDiff original="old" modified="new" path="file.ts" sideBySide={false} originalLabel="Original" modifiedLabel="Modified"
      toolbar={navigation => <header aria-label="Comparison toolbar">{navigation}</header>} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '下一处变更' })).toBeEnabled());
    expect(container.querySelectorAll('header')).toHaveLength(1);
    expect(container.querySelector('.code-diff-labels')).toBeNull();
  });
  it('updates existing models and disposes the view and both models when closed', async () => {
    const props = { original: 'old', modified: 'new', path: 'file.ts', sideBySide: true, originalLabel: 'Original', modifiedLabel: 'Modified' };
    const { rerender, unmount } = render(<CodeDiff {...props} />);
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ renderSideBySide: true }));
    rerender(<CodeDiff {...props} modified="updated" sideBySide={false} />);
    await waitFor(() => expect(mocks.update).toHaveBeenLastCalledWith({ renderSideBySide: false }));
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.createModel).toHaveBeenCalledTimes(2);
    expect(mocks.labels).toHaveBeenCalledWith({ ariaLabel: 'Modified' });
    unmount();
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.modelDispose).toHaveBeenCalledTimes(2);
  });

  it('renders the shared error surface when initialization fails', async () => {
    mocks.create.mockImplementationOnce(() => { throw new Error('Initialization failed'); });
    render(<CodeDiff original="" modified="" path="file.ts" sideBySide originalLabel="Original" modifiedLabel="Modified" />);
    await waitFor(() => expect(screen.getByText('无法加载差异')).toBeVisible());
    expect(screen.getByRole('button', { name: '重试' })).toBeVisible();
  });
});
