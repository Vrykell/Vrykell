import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import SshResourceChart, { resourceHistoryWindow, resourceTrendSegments } from '../components/SshResourceChart';

it('grows the visible range by real elapsed minutes up to the retained five-minute limit', () => {
  expect(resourceHistoryWindow(undefined, 0)).toBe(60_000);
  expect(resourceHistoryWindow(0, 45_000)).toBe(60_000);
  expect(resourceHistoryWindow(0, 75_000)).toBe(120_000);
  expect(resourceHistoryWindow(0, 600_000)).toBe(300_000);
  expect(resourceHistoryWindow(60_000, 0)).toBe(60_000);
});

it('names the metric beside its maximum scale without changing the accessible chart name', () => {
  render(<SshResourceChart endTime={0} label="Transfer history" caption="Throughput" maximumLabel="4 KB/s" />);
  const chart = screen.getByRole('img', { name: 'Transfer history' });
  const scale = chart.closest('.ssh-resource-chart')!.querySelector('.ssh-resource-chart-axis')!;
  expect(scale.firstElementChild).toHaveTextContent('Throughput');
  expect(scale.lastElementChild).toHaveTextContent('4 KB/s');
});

it('uses the visible minute range without stretching samples into unmeasured time', () => {
  expect(resourceTrendSegments([{ time: 0, value: 0 }, { time: 15_000, value: 50 }, { time: 30_000, value: 100 }], 30_000, 100, 60_000))
    .toEqual(['140.0,74.0 209.0,40.0 278.0,6.0']);
  const view = render(<SshResourceChart samples={[{ time: 0, value: 100 }, { time: 15_000, value: 0 }]} endTime={15_000} label="Usage" />);
  const frame = screen.getByRole('img', { name: 'Usage' }).closest('.ssh-resource-chart')!;
  expect(frame).toHaveAttribute('data-window-ms', '60000');
  expect(frame.querySelector('.ssh-resource-chart-axis')).toHaveTextContent('100%');
  expect(frame.querySelector('.ssh-status-time-axis')).toHaveTextContent('最近 1 分钟0%');
  view.rerender(<SshResourceChart samples={[{ time: 0, value: 100 }]} endTime={90_000} label="Usage" />);
  expect(frame).toHaveAttribute('data-window-ms', '120000');
  expect(frame.querySelector('.ssh-status-time-axis')).toHaveTextContent('最近 2 分钟0%');
});

it('plots real readings on a fixed five-minute axis and bounds percentages', () => {
  expect(resourceTrendSegments([{ time: 270000, value: 0 }, { time: 285000, value: 50 }, { time: 300000, value: 100 }], 300000))
    .toEqual(['250.4,74.0 264.2,40.0 278.0,6.0']);
  expect(resourceTrendSegments([{ time: 0, value: 120 }], 0)).toEqual(['278.0,6.0']);
  expect(resourceTrendSegments([], 0)).toEqual([]);
});

it('frames the measured range with horizontal and vertical grid lines', () => {
  render(<SshResourceChart samples={[]} endTime={0} label="Usage grid" />);
  const chart = screen.getByRole('img', { name: 'Usage grid' });
  const frame = chart.querySelector('rect')!;
  expect(frame).toHaveAttribute('x', '2');
  expect(frame).toHaveAttribute('width', '276');
  expect(frame).toHaveAttribute('height', '68');
  const grid = [...chart.querySelectorAll('line')];
  expect(grid.filter(line => line.getAttribute('x1') === line.getAttribute('x2'))).toHaveLength(7);
  expect(grid.filter(line => line.getAttribute('y1') === line.getAttribute('y2'))).toHaveLength(3);
});

it('leaves gaps after interruptions and discards expired, future and invalid readings', () => {
  expect(resourceTrendSegments([{ time: 0, value: 10 }, { time: 15000, value: 20 }, { time: 75000, value: 30 }], 75000)).toHaveLength(2);
  expect(resourceTrendSegments([{ time: -1, value: 10 }, { time: 300001, value: 20 }, { time: 300000, value: NaN }], 300000)).toEqual([]);
});

it('keeps an empty chart explicit and renders a single measured sample as a point', () => {
  const view = render(<SshResourceChart samples={[]} endTime={0} label="Memory history" />);
  expect(screen.getByText('等待采样…')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Memory history' }).querySelectorAll('polyline')).toHaveLength(0);
  view.rerender(<SshResourceChart samples={[{ time: 0, value: 10 }]} endTime={0} label="Memory history" />);
  expect(screen.queryByText('等待采样…')).not.toBeInTheDocument();
  const chart = screen.getByRole('img', { name: 'Memory history' });
  expect(chart.querySelectorAll('circle')).toHaveLength(1);
  expect(chart.querySelectorAll('polyline')).toHaveLength(0);
});

it('fills only measured segments without bridging missing data', () => {
  const { container } = render(<SshResourceChart samples={[{ time: 0, value: 20 }, { time: 15000, value: 30 }, { time: 75000, value: 40 }]} endTime={75000} label="CPU history" />);
  expect(container.querySelectorAll('polygon')).toHaveLength(1);
  expect(container.querySelectorAll('polyline')).toHaveLength(1);
  expect(container.querySelectorAll('circle')).toHaveLength(1);
});
