import ReactMarkdown, { type ExtraProps } from 'react-markdown';
import type { ComponentPropsWithoutRef } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { t } from '@i18n';
import { useToastStore } from '@ui/feedback/Toast';
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

interface MathNode {
  type: string;
  value?: string;
  children?: MathNode[];
  data?: { hName: string; hProperties: { className: string[] }; hChildren: { type: string; value?: string }[] };
}

// A standalone single-line formula needs display layout and must replace its paragraph:
// micromark parses `$$E=mc^2$$` alone on a line as inlineMath (flow math wants a newline after
// the opener), while an LLM writes standalone formulas as single-line `$$` almost always, so an
// exclusive inlineMath is upgraded to block math and KaTeX displays it in display mode.
function remarkStandaloneMathDisplay() {
  const walk = (node: MathNode) => {
    if (
      node.type === 'paragraph' &&
      Array.isArray(node.children) &&
      node.children.length === 1 &&
      node.children[0].type === 'inlineMath'
    ) {
      const mathNode = node.children[0];
      node.type = 'math';
      node.value = mathNode.value;
      node.data = {
        hName: 'div',
        hProperties: { className: ['math', 'math-display'] },
        hChildren: [{ type: 'text', value: mathNode.value }],
      };
      delete node.children;
    }
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };
  return walk;
}

function MathSpan({ node: _node, className, children, ...props }: ComponentPropsWithoutRef<'span'> & ExtraProps) {
  const span = <span {...props} className={className}>{children}</span>;
  return className?.split(' ').includes('katex-display')
    ? <span className="md-math-scroll scroll-region" role="region" aria-label={t('Math formula')} tabIndex={0}>{span}</span>
    : span;
}

export default function Markdown({ content, paneId }: { content: string; paneId?: string | null }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfmSafe, remarkMath, remarkStandaloneMathDisplay]}
      // Incomplete or non-mathematical dollar fragments remain readable during streaming.
      rehypePlugins={[[rehypeKatex, { throwOnError: false, errorColor: 'var(--error)' }]]}
      components={{
        a: Link,
        span: MathSpan,
        pre: (props) => <CommandBlock {...props} paneId={paneId} />,
        // Remote images remain links to avoid tracking and blocked image placeholders.
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
