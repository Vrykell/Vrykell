import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import SshResourceChart, { resourceTrendSegments } from '../components/SshResourceChart';

it('plots real readings on a fixed five-minute axis and bounds percentages', () => {
  expect(resourceTrendSegments([{ time: 270000, value: 0 }, { time: 285000, value: 50 }, { time: 300000, value: 100 }], 300000))
    .toEqual(['250.4,74.0 264.2,40.0 278.0,6.0']);
  expect(resourceTrendSegments([{ time: 0, value: 120 }], 0)).toEqual(['278.0,6.0']);
  expect(resourceTrendSegments([], 0)).toEqual([]);
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
