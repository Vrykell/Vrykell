import type { SearchResult } from '@features/search/types';

interface Props {
  result: SearchResult;
  selected: boolean;
  query: string;
  onSelect: () => void;
  onExecute: (result: SearchResult) => void;
}

/** Split text into highlighted and plain segments for the query. */
function highlightFragments(
  text: string,
  query: string,
): Array<{ text: string; hl: boolean }> {
  if (!query || !text) return [{ text, hl: false }];
  const lower = text.toLowerCase();
  const ql = query.toLowerCase();
  const parts: Array<{ text: string; hl: boolean }> = [];
  let pos = 0;
  while (pos < text.length) {
    const idx = lower.indexOf(ql, pos);
    if (idx === -1) {
      parts.push({ text: text.slice(pos), hl: false });
      break;
    }
    if (idx > pos) parts.push({ text: text.slice(pos, idx), hl: false });
    parts.push({ text: text.slice(idx, idx + ql.length), hl: true });
    pos = idx + ql.length;
  }
  return parts;
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const fragments = highlightFragments(text, query);
  return (
    <>
      {fragments.map((f, i) =>
        f.hl ? (
          <mark key={i} style={{
            background: 'var(--search-highlight-bg)',
            color: 'inherit',
            borderRadius: 2,
            padding: '0 1px',
          }}>
            {f.text}
          </mark>
        ) : (
          <span key={i}>{f.text}</span>
        ),
      )}
    </>
  );
}

/** Compact result row: one title line and at most one secondary line. */
export default function SearchResultCard({
  result, selected, query, onSelect, onExecute,
}: Props) {
  const secondary = result.subtitle || result.detail;
  const isMonoTitle = result.type === 'history';

  return (
    <div className="workspace-floating-row global-search-result" data-search-result data-selected={selected}
      onClick={() => onExecute(result)}
      onPointerMove={onSelect}
      style={{
        width: '100%',
        textAlign: 'left',
        padding: '7px 12px',
        marginBottom: 2,
        border: 'none',
        color: 'var(--text-primary)',
        cursor: 'pointer',
        fontSize: 'calc(12px * var(--ui-font-scale))',
        fontFamily: 'var(--font-ui)',
      }}
    >
      <div style={{
        fontWeight: 'var(--fw-semibold)',
        fontSize: 'calc(13px * var(--ui-font-scale))',
        lineHeight: 1.35,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontFamily: isMonoTitle ? 'var(--font-mono)' : undefined,
      }}>
        {query ? <HighlightedText text={result.title} query={query} /> : result.title}
      </div>
      {secondary && (
        <div style={{
          fontSize: 'calc(11px * var(--ui-font-scale))',
          lineHeight: 1.3,
          color: 'var(--text-muted)',
          marginTop: 3,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontFamily: result.type === 'block' ? 'var(--font-mono)' : undefined,
        }}>
          {query ? <HighlightedText text={secondary} query={query} /> : secondary}
        </div>
      )}
    </div>
  );
}
