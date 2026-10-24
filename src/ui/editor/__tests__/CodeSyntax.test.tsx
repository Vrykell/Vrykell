import { render, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import CodeSyntax from '@ui/editor/CodeSyntax';
const tokens = vi.hoisted(() => ({ colorize: vi.fn().mockResolvedValue(''), tokenize: vi.fn().mockReturnValue([[{ offset: 0, type: 'keyword' }, { offset: 5, type: 'string' }], [{ offset: 0, type: 'comment' }]]) }));
vi.mock('@ui/editor/code/runtime', () => ({ editorApi: { editor: tokens, languages: { getLanguages: () => [{ id: 'typescript' }] } } }));

it('colors all fenced lines with theme tokens while preserving literal source and newlines', async () => {
  const text = 'const value = "<img onerror=bad()>";\n// second line\n';
  const { container, rerender } = render(<CodeSyntax text={text} language="ts" />);
  await waitFor(() => expect(container.querySelector('[data-code-token="keyword"]')).not.toBeNull());
  expect(container.textContent).toBe(text); expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('[data-code-token="comment"]')).toHaveTextContent('// second line');
  rerender(<CodeSyntax text="unchanged plain text" language="unknown" />);
  expect(container.textContent).toBe('unchanged plain text'); expect(container.querySelector('[data-code-token]')).toBeNull();
});
