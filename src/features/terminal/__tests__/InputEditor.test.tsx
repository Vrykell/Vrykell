import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import InputEditor from '../components/InputEditor';

vi.mock('../hooks/useInputEditorController', () => ({
  useInputEditorController: () => ({
    inputRef: { current: null }, panelRef: { current: null }, text: '', aiMode: false,
    visible: true, isFocused: true, hasSession: true, terminalLabel: 'Bash',
    tabCwd: '/work', recentGitBranch: 'dev', ghost: '',
  }),
}));
vi.mock('../components/DirectoryPicker', () => ({
  default: () => <span className="terminal-chip terminal-directory">/work</span>,
}));
afterEach(cleanup);

it('separates shell, directory and branch chips with spacing instead of dots', () => {
  const { container } = render(<InputEditor paneId="pane" />);
  const status = container.querySelector<HTMLElement>('.terminal-input-status')!;
  expect(status).not.toHaveTextContent('·');
  expect(status.querySelectorAll('.terminal-chip')).toHaveLength(3);
  expect(status.style.gap).toBe('6px');
  expect(status.querySelector('.terminal-chip > span[style]')).not.toBeNull();
});
