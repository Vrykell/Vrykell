import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { CommandHistoryPage } from '../pages/commandHistoryPage';
import { useCommandHistorySettings } from '@config/commandHistory';
beforeEach(() => useCommandHistorySettings.setState({ runIn: 'new', doubleClick: 'insert', migrated: true }));
it('edits the global execution target and double-click action through shared selects', () => {
  render(<CommandHistoryPage />);
  fireEvent.click(screen.getByRole('combobox', { name: '命令执行目标' }));
  fireEvent.click(screen.getByRole('option', { name: '当前终端' }));
  fireEvent.click(screen.getByRole('combobox', { name: '双击命令' }));
  fireEvent.click(screen.getByRole('option', { name: '运行命令' }));
  expect(useCommandHistorySettings.getState()).toMatchObject({ runIn: 'current', doubleClick: 'run' });
});
