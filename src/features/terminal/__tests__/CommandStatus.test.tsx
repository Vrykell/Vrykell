import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import CommandStatus from '../components/CommandStatus';

describe('command result metadata', () => {
  it('keeps an accessible exit code, duration and optional agent indicator', () => {
    const { rerender } = render(<CommandStatus exitCode={0} duration={1400} agent />);
    expect(screen.getByLabelText('退出码 0')).toHaveTextContent('0');
    expect(screen.getByText('(1.4s)')).toBeVisible();
    expect(screen.getByLabelText('AI 执行')).toBeInTheDocument();
    rerender(<CommandStatus exitCode={1} duration={0} />);
    expect(screen.getByLabelText('退出码 1')).toHaveAttribute('data-failed', 'true');
    expect(screen.getByText('(0ms)')).toBeVisible();
    expect(screen.queryByLabelText('AI 执行')).not.toBeInTheDocument();
    rerender(<CommandStatus exitCode={null} duration={null} />);
    expect(screen.queryByTestId('exit-code')).not.toBeInTheDocument();
  });
});
