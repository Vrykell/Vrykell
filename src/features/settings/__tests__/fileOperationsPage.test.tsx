import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { FileOperationsPage } from '../pages/fileOperationsPage';
import { useFileUndoSettings } from '@config/fileUndo';

beforeEach(() => useFileUndoSettings.setState({ local: true, remote: true }));
it('persists independent local and remote undo choices', async () => {
  render(<FileOperationsPage />);
  fireEvent.click(screen.getByRole('switch', { name: '远程文件撤销' }));
  await waitFor(() => expect(useFileUndoSettings.getState()).toMatchObject({ local: true, remote: false }));
  fireEvent.click(screen.getByRole('switch', { name: '本地文件撤销' }));
  await waitFor(() => expect(useFileUndoSettings.getState()).toMatchObject({ local: false, remote: false }));
  const saved = JSON.parse(localStorage.getItem('vrykell-file-undo') ?? '{}') as { state: { local: boolean; remote: boolean } };
  expect(saved.state).toEqual({ local: false, remote: false });
});
