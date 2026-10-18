import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import FilePropertiesDialog from '@features/files/components/FilePropertiesDialog';
import { t } from '@i18n';
import type { FileStat } from '@platform/api/types';

/** A resolved stat record; tests override just the fields under test. */
const stat = (overrides: Partial<FileStat> = {}): FileStat => ({
  name: 'notes.txt',
  path: '/home/e2e/notes.txt',
  is_dir: false,
  is_symlink: false,
  size: 1536,
  created_ms: 1_700_000_000_000,
  modified_ms: 1_700_000_001_000,
  ...overrides,
});

const file = { name: 'notes.txt', path: '/home/e2e/notes.txt', is_dir: false };

describe('FilePropertiesDialog', () => {
  it('shows the metadata rows once stat resolves', async () => {
    render(<FilePropertiesDialog entry={file} location="/home/e2e" stat={async () => stat()} onClose={() => {}} />);

    expect(screen.getByRole('dialog', { name: t('Properties') })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('正在读取属性…');
    await waitFor(() => expect(screen.getByTestId('file-property-name')).toHaveTextContent('notes.txt'));
    expect(screen.getByTestId('file-property-type')).toHaveTextContent('TXT 文件');
    expect(screen.getByTestId('file-property-location')).toHaveTextContent('/home/e2e');
    expect(screen.getByTestId('file-property-size')).toHaveTextContent('1.5 KB');
    expect(screen.getByTestId('file-property-modified')).toHaveTextContent('2023');
    expect(screen.getByTestId('file-property-created')).toBeInTheDocument();
  });

  it('describes folders without a size row and hides times the backend omits', async () => {
    render(
      <FilePropertiesDialog
        entry={{ name: 'Documents', path: '/home/e2e/Documents', is_dir: true }}
        location="/home/e2e"
        stat={async () => stat({ name: 'Documents', path: '/home/e2e/Documents', is_dir: true, size: 0, created_ms: null, modified_ms: null })}
        onClose={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('file-property-type')).toHaveTextContent('文件夹'));
    expect(screen.queryByTestId('file-property-size')).toBeNull();
    expect(screen.queryByTestId('file-property-modified')).toBeNull();
    expect(screen.queryByTestId('file-property-created')).toBeNull();
  });

  it('renders a readable error box when metadata cannot be read', async () => {
    render(<FilePropertiesDialog entry={file} location="" stat={async () => { throw new Error('permission denied'); }} onClose={() => {}} />);

    const box = await screen.findByRole('alert');
    expect(box).toHaveTextContent('无法读取文件属性');
    expect(box).toHaveTextContent('permission denied');
  });

  it('closes from the labeled footer button and from the overlay', async () => {
    const onClose = vi.fn();
    render(<FilePropertiesDialog entry={file} location="/home/e2e" stat={async () => stat()} onClose={onClose} />);

    // One labeled close action replaces the heading icon.
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent(t('Close'));
    fireEvent.click(buttons[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(document.querySelector('.tool-dialog-overlay')!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
