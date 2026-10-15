import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import SshCpuTrend, { cpuTrendSegments } from '../components/SshCpuTrend';

afterEach(cleanup);

it('plots bounded CPU readings against their timestamps', () => {
  expect(cpuTrendSegments([{ time: 0, value: 0 }, { time: 15000, value: 50 }, { time: 30000, value: 100 }]))
    .toEqual(['2.0,58.0 120.0,31.0 238.0,4.0']);
  expect(cpuTrendSegments([{ time: 0, value: 120 }])).toEqual(['238.0,4.0']);
  expect(cpuTrendSegments([])).toEqual([]);
});

it('leaves interruptions as separate segments instead of inventing continuous history', () => {
  expect(cpuTrendSegments([{ time: 0, value: 10 }, { time: 15000, value: 20 }, { time: 75000, value: 30 }])).toHaveLength(2);
});

it('renders only measured history and shows a single reading as a point', () => {
  const view = render(<SshCpuTrend samples={[]} />);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  view.rerender(<SshCpuTrend samples={[{ time: 0, value: 10 }]} />);
  const chart = screen.getByRole('img', { name: '近期 CPU 使用率' });
  expect(chart.querySelectorAll('circle')).toHaveLength(1);
  expect(chart.querySelectorAll('polyline')).toHaveLength(0);
});
