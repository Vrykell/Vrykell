import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Markdown from '@features/chat/components/Markdown';

describe('Markdown', () => {
  it('去掉未闭合的强调标记，同时保留成对的加粗', () => {
    const stray = render(<Markdown content={'关键位置：现价距 **52 周高点 348.15 与 200 日均线（292.46）。'} />);
    expect(stray.container.textContent).toContain('52 周高点');
    expect(stray.container.textContent).not.toContain('**');

    const bold = render(<Markdown content={'**重点**内容'} />);
    expect(bold.container.querySelector('strong')?.textContent).toBe('重点');
  });

  it('渲染 GFM 表格', () => {
    const { container } = render(<Markdown content={'| a | b |\n|---|---|\n| 1 | 2 |'} />);
    expect(container.querySelector('table')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('渲染 $$...$$ 为 KaTeX block', () => {
    const { container } = render(<Markdown content={'公式：\n\n$$E = mc^2$$'} />);
    expect(container.querySelector('.katex-display')).toBeInTheDocument();
  });

  it('渲染行内 $...$ 为 KaTeX inline', () => {
    const { container } = render(<Markdown content={'其中 $x^2$ 是平方'} />);
    expect(container.querySelector('.katex')).toBeInTheDocument();
  });

  it('wraps display math in a focusable scroll surface while keeping positioning styles', () => {
    const { container } = render(<Markdown content={String.raw`$$\nabla^2\mathbf{E}-\frac{1}{c^2}\frac{\partial^2\mathbf{E}}{\partial t^2}=0,\quad c=\frac{1}{\sqrt{\varepsilon_0\mu_0}}$$`} />);
    const formula = screen.getByRole('region', { name: '数学公式' });
    expect(formula).toHaveAttribute('tabindex', '0');
    expect(formula.querySelector('.katex-display')).toBeInTheDocument();
    expect(formula.querySelector('.vlist [style]')).toBeInTheDocument();
    expect(container.querySelector('p > div')).not.toBeInTheDocument();
    expect(container.querySelector('p')).not.toBeInTheDocument();
  });

  it('keeps inline math inline and wraps multiline display math once', () => {
    const { container } = render(<Markdown content={'Inline $x^2$ here.\n\n$$\n\\frac{a}{b}\n$$'} />);
    expect(container.querySelector('p .katex')).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: '数学公式' })).toHaveLength(1);
    expect(container.querySelector('.md-math-scroll .md-math-scroll')).not.toBeInTheDocument();
  });

  it('keeps the formula scroll surface mounted while later answer text streams', () => {
    const content = '$$x^2+y^2=z^2$$';
    const view = render(<Markdown content={content} />);
    const formula = screen.getByRole('region', { name: '数学公式' });
    formula.scrollLeft = 30;
    view.rerender(<Markdown content={`${content}\n\nMore answer text`} />);
    expect(screen.getByRole('region', { name: '数学公式' })).toBe(formula);
    expect(formula.scrollLeft).toBe(30);
  });

  it('渲染代码块', () => {
    const { container } = render(<Markdown content={'```python\nprint(1)\n```'} />);
    expect(container.querySelector('pre code')).toBeInTheDocument();
  });

  it('渲染删除线与任务列表（GFM 重组版功能完好）', () => {
    const { container } = render(
      <Markdown content={'~~删掉~~\n\n- [x] 已完成\n- [ ] 待办'} />,
    );
    expect(container.querySelector('del')).toBeInTheDocument();
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
  });

  // 回归：autolink-literal 已从插件集中剔除（其 lookbehind 正则在旧 WebKit 抛
  // SyntaxError），裸 URL/邮箱必须保持纯文本，不得再自动生成 <a>。
  it('裸 URL 与邮箱渲染为纯文本（不 linkify）', () => {
    const { container } = render(
      <Markdown content={'参见 https://example.com 或 www.example.com，联系 a@b.com'} />,
    );
    expect(container.querySelector('a')).not.toBeInTheDocument();
    expect(container.textContent).toContain('https://example.com');
  });
});
