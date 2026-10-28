/**
 * Markdown rendering pipeline stress test — bombards react-markdown + remark-gfm +
 * remark-math + rehype-katex + CommandBlock(pre) with the kind of "dirty" output LLMs commonly
 * produce, to find input categories that throw. Any throw breaks through SafeMarkdown and shows
 * its fallback message; the requirement here is that none of them throw.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import Markdown from '@features/chat/components/Markdown';

const NASTY: Record<string, string> = {
  'dollar-sign command': '$ make test',
  'currency range': '成本大约 $5 ~ $10 之间',
  'adjacent currency amounts': '价格是 $100，另一个是 $200。',
  'unclosed inline math': '这是一个 $x + y 的例子',
  'single-line display math': '$$E=mc^2$$',
  'multiple inline math expressions': '$x$ 和 $y$ 都是变量',
  'invalid KaTeX command': '$\\notarealcommand{a}$',
  'empty math': '$$  $$',
  'four dollar signs': '$$$$',
  'unclosed block math': '$$\nx^2 + y^2',
  'math with Chinese characters': '$\\frac{一}{二}$',
  'unclosed code block': '```bash\nls -la\necho hi',
  'odd language code block': '```c++foo\nint main() {}\n```',
  'code block containing a dollar sign': '```sh\nexport A=$HOME\n```',
  'GFM autolink www': '访问 www.example.com/path?q=1_(2) 查看',
  'GFM autolink with parentheses': '见 https://en.wikipedia.org/wiki/Foo_(bar)',
  'angle-bracket link': '<https://example.com/a?b=c&d=e>',
  'email address': '联系 foo.bar+baz@example.com.cn',
  'URL immediately followed by Chinese text': '文档在https://example.com。请查收',
  'table': '| 列A | 列B |\n| --- | --- |\n| 1 | 2 |',
  'unclosed table row': '| a | b |\n| --- | --- |\n| 1 |',
  'table containing a dollar sign': '| 价格 |\n| --- |\n| $5 |',
  'inline HTML': '<div class="x">hello</div>',
  'incomplete HTML': '这是一个 <div 标签',
  'strikethrough': '~~已废弃~~ 新方案',
  'task list': '- [x] 完成\n- [ ] 未完',
  'footnote reference': '这里有个引用[^1]\n\n[^1]: 注释内容',
  'unclosed link': '[点击这里](https://exam',
  'unclosed image': '![截图](',
  'nested emphasis': '**粗体 *斜体* 混合**',
  'underscore identifiers': 'foo_bar_baz 和 __init__',
  'scattered asterisks': '2 * 3 * 4 = 24',
  'blockquote containing math': '> 公式 $x^2$ 如上',
  'list containing a code block': '1. 步骤一\n\n   ```sh\n   make\n   ```\n2. 步骤二',
  'tilde code fence': '~~~python\nprint(1)\n~~~',
  'mixed disaster': '运行 `$ make` 后成本 $5，公式 $\\alpha$ 见 www.a.com_(1) |表|\n|-|\n|~~x~~|',
  'backslash escapes': '路径 C:\\Users\\test\\$HOME',
  'multiline math block': '$$\n\\begin{aligned}\na &= b \\\\\n&= c\n\\end{aligned}\n$$',
  'percent sign escape': '$100\\%$ 完成',
};

describe('Markdown pipeline resilience', () => {
  for (const [name, content] of Object.entries(NASTY)) {
    it(`does not throw: ${name}`, () => {
      let html = '';
      expect(() => {
        html = renderToStaticMarkup(createElement(Markdown, { content }));
      }).not.toThrow();
      expect(html.length).toBeGreaterThan(0);
    });
  }
});
