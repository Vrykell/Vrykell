import ReactMarkdown, { type ExtraProps } from 'react-markdown';
import type { ComponentPropsWithoutRef } from 'react';
import remarkGfmSafe from '@features/chat/model/remarkGfmSafe';
import remarkStripStrayEmphasis from '@features/chat/model/remarkStripStrayEmphasis';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import CommandBlock from '@features/chat/components/CommandBlock';
import { t } from '@i18n';
import 'katex/dist/katex.min.css';

interface MathNode {
  type: string;
  value?: string;
  children?: MathNode[];
  data?: { hName: string; hProperties: { className: string[] }; hChildren: { type: string; value?: string }[] };
}

// A standalone single-line formula needs display layout and must replace its paragraph.
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
      remarkPlugins={[remarkGfmSafe, remarkStripStrayEmphasis, remarkMath, remarkStandaloneMathDisplay]}
      // Incomplete or non-mathematical dollar fragments remain readable during streaming.
      rehypePlugins={[[rehypeKatex, { throwOnError: false, errorColor: 'var(--error)' }]]}
      components={{
        span: MathSpan,
        pre: (props) => <CommandBlock {...props} paneId={paneId} />,
        // Remote images remain links to avoid tracking and blocked image placeholders.
        img: (props) => (
          <a href={props.src} data-tip={props.alt} style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
            {props.alt || props.src}
          </a>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
