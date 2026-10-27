import { render, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import CodeSyntax from '@ui/editor/CodeSyntax';

const tokens = vi.hoisted(() => ({ colorize: vi.fn(), tokenize: vi.fn() }));
vi.mock('@ui/editor/code/runtime', () => ({ editorApi: { editor: tokens, languages: { getLanguages: () => [{ id: 'typescript' }] } } }));

beforeEach(() => {
  tokens.colorize.mockReset().mockResolvedValue('');
  tokens.tokenize.mockReset().mockReturnValue([[{ offset: 0, type: 'keyword' }, { offset: 5, type: 'string' }], [{ offset: 0, type: 'comment' }]]);
});

it('colors all fenced lines with theme tokens while preserving literal source and newlines', async () => {
  const text = 'const value = "<img onerror=bad()>";\n// second line\n';
  const { container, rerender } = render(<CodeSyntax text={text} language="ts" />);
  await waitFor(() => expect(container.querySelector('[data-code-token="keyword"]')).not.toBeNull());
  expect(container.textContent).toBe(text); expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('[data-code-token="comment"]')).toHaveTextContent('// second line');
  rerender(<CodeSyntax text="unchanged plain text" language="unknown" />);
  expect(container.textContent).toBe('unchanged plain text'); expect(container.querySelector('[data-code-token]')).toBeNull();
});

it('keeps streamed lines colored in the same commit that appends new text', async () => {
  const initial = 'const value = 1;\n// first line';
  const { container, rerender } = render(<CodeSyntax text={initial} language="ts" />);
  await waitFor(() => expect(container.querySelector('[data-code-token="comment"]')).not.toBeNull());

  tokens.tokenize.mockReturnValue([
    [{ offset: 0, type: 'keyword' }, { offset: 6, type: 'string' }],
    [{ offset: 0, type: 'comment' }],
    [{ offset: 0, type: 'number' }],
  ]);
  const streamed = `${initial}\n42`;
  rerender(<CodeSyntax text={streamed} language="ts" />);

  // A new chunk must not push the block back to uncolored text while highlighting catches up.
  expect(container.querySelector('[data-code-token="comment"]')).not.toBeNull();
  expect(container.querySelector('[data-code-token="number"]')).not.toBeNull();
  expect(container.textContent).toBe(streamed);
});
