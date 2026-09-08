import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Markdown from '@/features/chat/Markdown';

describe('Markdown', () => {
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

  it('渲染代码块', () => {
    const { container } = render(<Markdown content={'```python\nprint(1)\n```'} />);
    expect(container.querySelector('pre code')).toBeInTheDocument();
  });

  it('渲染删除线与任务列表（GFM 重组版功能完好）', () => {
    const { container } = render(<Markdown content={'~~删掉~~\n\n- [x] 已完成\n- [ ] 待办'} />);
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
