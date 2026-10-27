import { OutlineButton } from '@ui/actions/OutlineButton';
import {
  Command, History, Monitor, Settings, SquareTerminal, Undo2, type AppIcon,
} from '@ui/icons';
import { fileIcon } from '@features/files/utils/fileIcon';
import KeyHint from '@ui/feedback/KeyHint';
import { t } from '@i18n';
import type {
  SearchResult,
  BlockResultData,
  FileResultData,
  SessionResultData,
  ActionResultData,
} from '@features/search/types';

interface Props {
  result: SearchResult;
  selected: boolean;
  query: string;
  onSelect: () => void;
  onExecute: (result: SearchResult) => void;
  /** Restore the historical session. */
  onRestore?: (sessionId: string, sessionTitle: string) => void;
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

export default function SearchResultCard({
  result, selected, query, onSelect, onExecute, onRestore,
}: Props) {
  const isHistory = result.type === 'history';
  const isBlock = result.type === 'block';
  const isSession = result.type === 'session';

  const blockData = isBlock ? (result.data as BlockResultData) : null;
  const sessionData = isSession ? (result.data as SessionResultData) : null;
  const isHistoricalBlock = isBlock && blockData?.sessionStatus === 'historical';
  const isHistoricalSession = isSession && sessionData?.status === 'historical';

  return (
    <div className="workspace-floating-row global-search-result" data-search-result data-selected={selected}
      onClick={(e) => {
        // Historical session or block: clicking the card restores it, like the restore button.
        if (isHistoricalBlock && onRestore) {
          e.stopPropagation();
          onRestore(blockData!.tabId, blockData!.tabTitle ?? '');
        } else if (isHistoricalSession && onRestore) {
          e.stopPropagation();
          onRestore(sessionData!.sessionId, sessionData!.title);
        } else {
          onExecute(result);
        }
      }}
      onMouseEnter={onSelect}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        width: '100%',
        textAlign: 'left',
        padding: '9px 10px',
        marginBottom: 2,
        border: 'none',
        color: 'var(--text-primary)',
        cursor: 'pointer',
        fontSize: 'calc(12px * var(--ui-font-scale))',
        fontFamily: 'var(--font-ui)',
        transition: 'background 0.1s',
        position: 'relative',
      }}
    >
      {/* Type icon */}
      <span style={{
        flexShrink: 0, width: 20, marginTop: 1,
        display: 'inline-flex', justifyContent: 'center', color: 'var(--text-muted)',
      }}>
        {(() => { const Icon = typeIcon(result); return <Icon size={16} />; })()}
      </span>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Primary title */}
        <div style={{
          fontWeight: 'var(--fw-semibold)', fontSize: 'calc(13px * var(--ui-font-scale))',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          fontFamily: isHistory ? 'var(--font-mono)' : undefined,
        }}>
          {query ? <HighlightedText text={result.title} query={query} /> : result.title}
        </div>

        {/* Subtitle: highlighted output snippet */}
        {result.subtitle && (
          <div style={{
            fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)', marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis',
            whiteSpace: isBlock ? 'normal' : 'nowrap',
            fontFamily: isBlock ? 'var(--font-mono)' : undefined,
            maxHeight: isBlock ? 32 : undefined,
            lineHeight: 1.4,
          }}>
            {query ? <HighlightedText text={result.subtitle} query={query} /> : result.subtitle}
          </div>
        )}

        {/* Third line: detail and badge */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          marginTop: 3, fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)',
        }}>
          {result.type === 'action' && (result.data as ActionResultData).shortcut
            ? <KeyHint shortcut={(result.data as ActionResultData).shortcut!} />
            : result.detail && <span>{result.detail}</span>}
          {isBlock && blockData?.status && !isHistoricalBlock && (
            <span style={{
              fontSize: 'calc(10px * var(--ui-font-scale))', padding: '1px 5px', borderRadius: 4,
              background: blockData.status === 'completed'
                ? 'var(--hover)' : blockData.status === 'failed'
                ? 'var(--error-bg)' : 'var(--accent-bg)',
              color: blockData.status === 'completed'
                ? 'var(--text-secondary)' : blockData.status === 'failed'
                ? 'var(--error)' : 'var(--accent)',
            }}>
              {statusLabel(blockData.status)}
            </span>
          )}
          {/* Historical session badge */}
          {(isHistoricalBlock || isHistoricalSession) && (
            <span style={{
              fontSize: 'calc(10px * var(--ui-font-scale))', padding: '1px 5px', borderRadius: 4,
              background: 'var(--hover)',
              color: 'var(--text-secondary)',
            }}>
              {t('Historical session')}
            </span>
          )}
        </div>
      </div>

      {/* Restore button for a historical block or session */}
      {(isHistoricalBlock || isHistoricalSession) && onRestore && (
        <RestoreBtn
          onClick={(e) => {
            e.stopPropagation();
            if (isHistoricalBlock) {
              onRestore(blockData!.tabId, blockData!.tabTitle ?? '');
            } else if (isHistoricalSession) {
              onRestore(sessionData!.sessionId, sessionData!.title);
            }
          }}
        />
      )}
    </div>
  );
}

function RestoreBtn({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return (
    <OutlineButton
      onClick={onClick}
      data-tip={t('Restore this session')}
      aria-label={t('Restore this session')}
      style={{
        flexShrink: 0,
        width: 22, height: 22,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 4,
        fontSize: 'calc(10px * var(--ui-font-scale))',
        padding: 0,
        marginTop: -1,
        opacity: 0.8,
      }}
      onMouseEnter={(e) => {
        (e.target as HTMLElement).style.opacity = '1';
      }}
      onMouseLeave={(e) => {
        (e.target as HTMLElement).style.opacity = '0.8';
      }}
    >
      <Undo2 size={11} />
    </OutlineButton>
  );
}

function typeIcon(result: SearchResult): AppIcon {
  switch (result.type) {
    case 'history': return History;
    case 'block': return SquareTerminal;
    case 'file': {
      const d = result.data as FileResultData;
      return fileIcon(d.name, d.isDir);
    }
    case 'setting': return Settings;
    case 'action': return Command;
    case 'session': return Monitor;
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'running': return t('Running');
    case 'completed': return t('Completed');
    case 'failed': return t('Failed');
    default: return status;
  }
}
