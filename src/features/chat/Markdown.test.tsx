import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Markdown from '@features/chat/components/Markdown';
import { openUrl } from '@tauri-apps/plugin-opener';

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
  openPath: vi.fn().mockResolvedValue(undefined),
  revealItemInDir: vi.fn().mockResolvedValue(undefined),
}));

const openUrlMock = vi.mocked(openUrl);

beforeEach(() => openUrlMock.mockClear());

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

  // 回归：回复里的链接曾让整个应用窗口导航到目标页（应用界面消失）。现在 web 链接交系统
  // 浏览器打开，应用窗口原地不动。测试里 jsdom 无法真的导航，断言「交给系统」+ rel 即可。
  it('web 链接交给系统浏览器打开，不再导航应用窗口', async () => {
    render(<Markdown content={'[文档](https://example.com/a)'} />);
    const link = screen.getByRole('link', { name: '文档' });
    expect(link).toHaveAttribute('href', 'https://example.com/a');
    expect(link).toHaveAttribute('rel', 'noreferrer noopener');
    fireEvent.click(link);
    await waitFor(() => expect(openUrlMock).toHaveBeenCalledWith('https://example.com/a'));
  });

  // react-markdown 的默认 URL 过滤把 file:/自定义 scheme 清成空 href；渲染层再把空 href
  // 退化成纯文本，因此这类目标没有可点的锚点。
  it('file 与自定义 scheme 不渲染成可点链接', () => {
    render(<Markdown content={'[本地](file:///C:/Windows/System32/calc.exe)'} />);
    expect(screen.queryByRole('link', { name: '本地' })).toBeNull();
    expect(screen.getByText('本地')).toBeInTheDocument();
    expect(openUrlMock).not.toHaveBeenCalled();
  });
});
