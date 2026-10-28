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
  // Regression: `**` can be part of body text (globs, exponentiation, a closing marker the
  // model dropped); the renderer must not swallow it.
  it('keeps literal asterisk runs and only parses paired ones as bold', () => {
    const glob = render(<Markdown content={'删除 src/**/*.ts'} />);
    expect(glob.container.textContent).toContain('src/**/*.ts');

    const power = render(<Markdown content={'执行 2**10 次'} />);
    expect(power.container.textContent).toContain('2**10');

    const bold = render(<Markdown content={'**重点**内容'} />);
    expect(bold.container.querySelector('strong')?.textContent).toBe('重点');
  });

  it('renders GFM tables', () => {
    const { container } = render(<Markdown content={'| a | b |\n|---|---|\n| 1 | 2 |'} />);
    expect(container.querySelector('table')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders $$...$$ as a KaTeX block', () => {
    const { container } = render(<Markdown content={'公式：\n\n$$E = mc^2$$'} />);
    expect(container.querySelector('.katex-display')).toBeInTheDocument();
  });

  it('renders inline $...$ as KaTeX inline', () => {
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

  it('renders code blocks', () => {
    const { container } = render(<Markdown content={'```python\nprint(1)\n```'} />);
    expect(container.querySelector('pre code')).toBeInTheDocument();
  });

  it('renders strikethrough and task lists (the rebuilt GFM feature set stays intact)', () => {
    const { container } = render(
      <Markdown content={'~~删掉~~\n\n- [x] 已完成\n- [ ] 待办'} />,
    );
    expect(container.querySelector('del')).toBeInTheDocument();
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
  });

  // Regression: autolink-literal is no longer in the plugin set (its lookbehind regex throws
  // SyntaxError on older WebKit), so bare URLs and emails must stay plain text - no <a>.
  it('renders bare URLs and emails as plain text (no linkify)', () => {
    const { container } = render(
      <Markdown content={'参见 https://example.com 或 www.example.com，联系 a@b.com'} />,
    );
    expect(container.querySelector('a')).not.toBeInTheDocument();
    expect(container.textContent).toContain('https://example.com');
  });

  // Regression: a reply link once navigated the whole app window to the target page (the UI
  // vanished). Web links now go to the system browser and the app window stays put; jsdom cannot
  // navigate for real, so asserting the system hand-off plus rel is enough.
  it('opens web links in the system browser without navigating the app window', async () => {
    render(<Markdown content={'[文档](https://example.com/a)'} />);
    const link = screen.getByRole('link', { name: '文档' });
    expect(link).toHaveAttribute('href', 'https://example.com/a');
    expect(link).toHaveAttribute('rel', 'noreferrer noopener');
    fireEvent.click(link);
    await waitFor(() => expect(openUrlMock).toHaveBeenCalledWith('https://example.com/a'));
  });

  // react-markdown's default URL filter blanks file:/custom schemes to an empty href, and the
  // renderer degrades an empty href to plain text, so these targets have no clickable anchor.
  it('does not render file and custom schemes as clickable links', () => {
    render(<Markdown content={'[本地](file:///C:/Windows/System32/calc.exe)'} />);
    expect(screen.queryByRole('link', { name: '本地' })).toBeNull();
    expect(screen.getByText('本地')).toBeInTheDocument();
    expect(openUrlMock).not.toHaveBeenCalled();
  });
});
