/**
 * Markdown 渲染管线压测 — 用 LLM 常见的"脏"输出轰炸 react-markdown + remark-gfm +
 * remark-math + rehype-katex + CommandBlock(pre)，找出会抛异常的输入类别。
 * 任何 throw 都会击穿 SafeMarkdown 显示「无法渲染此消息」，这里要求全部不抛。
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import Markdown from './Markdown';

const NASTY: Record<string, string> = {
  '美元符号命令': '$ make test',
  '货币区间': '成本大约 $5 ~ $10 之间',
  '货币紧邻': '价格是 $100，另一个是 $200。',
  '未闭合行内公式': '这是一个 $x + y 的例子',
  '单行独立公式': '$$E=mc^2$$',
  '多个行内公式': '$x$ 和 $y$ 都是变量',
  '非法 KaTeX 命令': '$\\notarealcommand{a}$',
  '空公式': '$$  $$',
  '四个美元': '$$$$',
  '未闭合块公式': '$$\nx^2 + y^2',
  '公式带中文': '$\\frac{一}{二}$',
  '未闭合代码块': '```bash\nls -la\necho hi',
  '奇怪语言代码块': '```c++foo\nint main() {}\n```',
  '代码块含美元': '```sh\nexport A=$HOME\n```',
  'GFM 自动链接 www': '访问 www.example.com/path?q=1_(2) 查看',
  'GFM 自动链接括号': '见 https://en.wikipedia.org/wiki/Foo_(bar)',
  '尖括号链接': '<https://example.com/a?b=c&d=e>',
  '邮箱': '联系 foo.bar+baz@example.com.cn',
  'URL 紧跟中文': '文档在https://example.com。请查收',
  '表格': '| 列A | 列B |\n| --- | --- |\n| 1 | 2 |',
  '未闭合表格行': '| a | b |\n| --- | --- |\n| 1 |',
  '表格含美元': '| 价格 |\n| --- |\n| $5 |',
  '内嵌 HTML': '<div class="x">hello</div>',
  '不完整 HTML': '这是一个 <div 标签',
  '删除线': '~~已废弃~~ 新方案',
  '任务列表': '- [x] 完成\n- [ ] 未完',
  '脚注引用': '这里有个引用[^1]\n\n[^1]: 注释内容',
  '未闭合链接': '[点击这里](https://exam',
  '未闭合图片': '![截图](',
  '嵌套强调': '**粗体 *斜体* 混合**',
  '下划线标识符': 'foo_bar_baz 和 __init__',
  '星号散布': '2 * 3 * 4 = 24',
  '块引用含公式': '> 公式 $x^2$ 如上',
  '列表含代码块': '1. 步骤一\n\n   ```sh\n   make\n   ```\n2. 步骤二',
  '波浪线代码栅栏': '~~~python\nprint(1)\n~~~',
  '混合灾难': '运行 `$ make` 后成本 $5，公式 $\\alpha$ 见 www.a.com_(1) |表|\n|-|\n|~~x~~|',
  '反斜杠转义': '路径 C:\\Users\\test\\$HOME',
  '数学块多行': '$$\n\\begin{aligned}\na &= b \\\\\n&= c\n\\end{aligned}\n$$',
  '百分号注释': '$100\\%$ 完成',
};

describe('Markdown 管线抗压', () => {
  for (const [name, content] of Object.entries(NASTY)) {
    it(`不抛异常: ${name}`, () => {
      let html = '';
      expect(() => {
        html = renderToStaticMarkup(createElement(Markdown, { content }));
      }).not.toThrow();
      expect(html.length).toBeGreaterThan(0);
    });
  }
});
