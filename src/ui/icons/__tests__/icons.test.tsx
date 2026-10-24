import { createRef } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Brain, ChevronDown, FileCode, Folder, Search, Server, Settings, SquareTerminal, Navigation } from '@ui/icons';

describe('shared icon family', () => {
  it('uses a square terminal outline with restrained corner rounding', () => {
    const { container } = render(<SquareTerminal />); const rect = container.querySelector('rect')!;
    expect(rect.getAttribute('width')).toBe(rect.getAttribute('height')); expect(rect).toHaveAttribute('rx', '1.75');
  });
  it.each([
    [Brain, 24], [ChevronDown, 24], [Folder, 24], [Search, 24],
    [Server, 24], [Settings, 24], [SquareTerminal, 24],
    [Navigation, 24],
  ] as const)('renders themed vector icons at the requested size', (Icon, intrinsicSize) => {
    const { container } = render(<Icon size={16} style={{ color: 'var(--text-secondary)' }} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('viewBox', `0 0 ${intrinsicSize} ${intrinsicSize}`);
    expect(svg).toHaveStyle({ width: '16px', height: '16px', color: 'var(--text-secondary)' });
    expect(svg).toHaveAttribute('fill', Icon === SquareTerminal ? 'none' : 'currentColor');
    if (Icon !== SquareTerminal) expect(svg).toHaveAttribute('data-fui-icon');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
    expect(svg.querySelector('path')).not.toBeNull();
  });

  it('allows explicit accessible labels and per-icon styling', () => {
    const { container } = render(<Folder size={32} color="var(--accent)" primaryFill="var(--text-secondary)" role="img" aria-label="文件夹" />);
    expect(container.querySelector('svg')).not.toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('svg')).toHaveStyle({ width: '32px', height: '32px', color: 'var(--accent)' });
    expect(container.querySelector('svg')).toHaveAttribute('fill', 'var(--text-secondary)');
  });

  it('forwards refs to the rendered SVG', () => {
    const ref = createRef<SVGSVGElement>();
    const { container } = render(<Settings ref={ref} />);
    expect(ref.current).toBe(container.querySelector('svg'));
  });

  it('keeps titled icons accessible and supports an explicit decorative override', () => {
    const { container, rerender } = render(<Folder title="文件夹" />);
    expect(container.querySelector('svg')).not.toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('svg')).toHaveAttribute('aria-label', '文件夹');
    expect(container.querySelector('svg')).toHaveAttribute('role', 'img');
    rerender(<Folder aria-label="文件夹" aria-hidden={true} />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps explicit dimensions and styles on small native variants', () => {
    const { container } = render(<FileCode size={14} width={18} style={{ height: 20, opacity: 0.6 }} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('viewBox', '0 0 16 16');
    expect(svg).toHaveStyle({ width: '18px', height: '20px', opacity: '0.6' });
  });
});
