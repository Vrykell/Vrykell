import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import SshNetworkRates from '../components/SshNetworkRates';

it('shows measured rates and plots both directions only in chart mode', () => {
  const samples = [{ time: 0, download: 10240, upload: 5120 }];
  const view = render(<SshNetworkRates samples={samples} display="bars" now={0} available />);
  expect(screen.getByText('10.0 KB/s')).toBeInTheDocument();
  expect(screen.getByText('5.0 KB/s')).toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  view.rerender(<SshNetworkRates samples={samples} display="chart" now={0} available />);
  const chart = screen.getByRole('img', { name: '上传与下载趋势' });
  expect(screen.getAllByRole('img')).toHaveLength(1);
  expect(chart.querySelectorAll('[data-series]')).toHaveLength(2);
});

it('distinguishes a missing baseline from unsupported counters without inventing zeros', () => {
  const samples = [{ time: 0, download: null, upload: null }];
  const view = render(<SshNetworkRates samples={samples} display="bars" now={0} available />);
  expect(screen.getByText('传输速率需要两次相邻采样。')).toBeInTheDocument();
  expect(screen.getAllByText('—')).toHaveLength(2);
  view.rerender(<SshNetworkRates samples={samples} display="bars" now={0} available={false} />);
  expect(screen.getByText('此服务器暂不提供传输速率。')).toBeInTheDocument();
});
