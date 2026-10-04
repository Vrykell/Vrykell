import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsSaveProvider, useSettingsSave } from '../components/SettingsSaveProvider';
import SaveStatus from '../components/SaveStatus';

describe('immediate settings save feedback', () => {
  it('reports errors, retries the same operation and then reports saved', async () => {
    const operation = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    function Example() {
      const { save, status, retry } = useSettingsSave();
      return <><button onClick={() => { void save(operation); }}>修改</button><SaveStatus status={status} onRetry={retry} /></>;
    }
    render(<SettingsSaveProvider><Example /></SettingsSaveProvider>);
    fireEvent.click(screen.getByRole('button', { name: '修改' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('保存失败'));
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已保存'));
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
