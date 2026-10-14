import ReactMarkdown from 'react-markdown';
import { openUrl } from '@tauri-apps/plugin-opener';
import { t } from '@i18n';
import { useToastStore } from '@ui/Toast';
import remarkGfmSafe from '@features/chat/model/remarkGfmSafe';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import CommandBlock from '@features/chat/components/CommandBlock';
import 'katex/dist/katex.min.css';

/** Schemes we hand to the operating system. Everything else stays inside the app. */
const EXTERNAL_SCHEMES = /^(https?|mailto|tel):/i;

/**
 * Link — a reply never navigates the app window.
 *
 * Content in a transcript comes from the model, fetched pages, skills and MCP servers, so a link
 * is third-party input. Following one used to navigate the whole webview (the shell disappeared
 * and a remote page took its place); now the allowed schemes open in the system browser and the
 * rest is refused with a note. react-markdown already clears other schemes (`file:`, `ms-msdt:`)
 * to an empty href; an empty href renders as plain text rather than a dead link.
 */
function Link({ href, children, node: _node, ...rest }: React.ComponentPropsWithoutRef<'a'> & { node?: unknown }) {
  const url = href ?? '';
  if (!url) return <span>{children}</span>;
  return <a {...rest} href={url} rel="noreferrer noopener" onClick={(event) => {
    event.preventDefault();
    if (EXTERNAL_SCHEMES.test(url)) {
      void openUrl(url).catch(() => {
        useToastStore.getState().addToast(t('Could not open the link.'), 'error');
      });
      return;
    }
    useToastStore.getState().addToast(t('Only http, https, mailto and tel links can be opened.'), 'info');
  }}>{children}</a>;
}

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

export default function Markdown({ content, paneId }: { content: string; paneId?: string | null }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfmSafe, remarkMath, remarkStandaloneMathDisplay]}
      // throwOnError: false — AI 回答里的 `$` 片段（如 `$ make test`）常被 remark-math
      // 误判为公式；KaTeX 抛错会击穿 SafeMarkdown。容错模式下原样显示源码。
      rehypePlugins={[[rehypeKatex, { throwOnError: false, errorColor: 'var(--error)' }]]}
      components={{
        a: Link,
        pre: (props) => <CommandBlock {...props} paneId={paneId} />,
        // 图片降级为链接文本：不加载远程图片（防追踪/外带，CSP 亦不放行 http(s) 图片源），
        // 同时避免因 CSP 拦截而裂图
        img: (props) => (
          <Link href={props.src} data-tip={props.alt} style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
            {props.alt || props.src}
          </Link>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
