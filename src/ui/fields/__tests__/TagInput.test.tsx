import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import TagInput from '@ui/fields/TagInput';

afterEach(cleanup);
function Example() {
  const [value, setValue] = useState<string[]>([]);
  return <><TagInput value={value} options={[{ value: 'production', color: 'var(--group-coral)' }]} onChange={setValue} /><output>{value.join(',')}</output></>;
}
it('chooses existing tags, creates tags and removes pills without a fake select', () => {
  render(<Example />);
  expect(screen.queryByRole('combobox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '已有标签' }));
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'production' }));
  expect(screen.getByRole('status')).toHaveTextContent('production');
  fireEvent.keyDown(window, { key: 'Escape' });
  const input = screen.getByRole('textbox', { name: '新标签' });
  fireEvent.change(input, { target: { value: 'api' } }); fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.getByRole('status')).toHaveTextContent('production,api');
  fireEvent.click(screen.getAllByRole('button', { name: '移除标签' })[0]);
  expect(screen.getByRole('status')).toHaveTextContent('api');
});
