import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

// micromark 把单行 `$$E=mc^2$$` 解析为 inlineMath（flow math 要求开界定符后换行），
// 而 LLM 输出的独立公式段几乎都是单行 $$ 形式。独占一段的 inlineMath 一律升级为
// block math，KaTeX 以 display 模式渲染。
function remarkStandaloneMathDisplay() {
  // mdast 节点无类型定义可依赖——只做结构判断，不动 value。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walk = (node: any) => {
    if (
      node.type === 'paragraph' &&
      Array.isArray(node.children) &&
      node.children.length === 1 &&
      node.children[0].type === 'inlineMath'
    ) {
      // type 和 data 都要改：mdast-util-math 在 data.hName/hProperties 里
      // 预置了 hast 形态，hast 转换优先读 data，只改 type 无效。
      // hChildren 必须显式带文本子节点——inlineMath 的公式在 value 里，
      // 没有 children，默认转换会得到空 div。
      const mathNode = node.children[0];
      mathNode.type = 'math';
      mathNode.data = {
        hName: 'div',
        hProperties: { className: ['math', 'math-display'] },
        hChildren: [{ type: 'text', value: mathNode.value }],
      };
    }
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };
  return walk;
}

export default function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath, remarkStandaloneMathDisplay]}
      rehypePlugins={[rehypeKatex]}
    >
      {content}
    </ReactMarkdown>
  );
}
