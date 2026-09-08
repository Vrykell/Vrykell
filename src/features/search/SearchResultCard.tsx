import {
  Command,
  History,
  type LucideIcon,
  Monitor,
  Settings,
  SquareTerminal,
  Undo2,
} from 'lucide-react';
import { fileIcon } from '@/features/files/fileIcon';
import type {
  BlockResultData,
  FileResultData,
  SearchResult,
  SessionResultData,
} from '@/features/search/types';

interface Props {
  result: SearchResult;
  selected: boolean;
  query: string;
  onSelect: () => void;
  onExecute: (result: SearchResult) => void;
  /** 恢复历史会话 */
  onRestore?: (sessionId: string, sessionTitle: string) => void;
}

/** 将文本按 query 拆分为高亮/非高亮片段 */
function highlightFragments(text: string, query: string): Array<{ text: string; hl: boolean }> {
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
          <mark
            key={i}
            style={{
              background: 'var(--search-highlight-bg)',
              color: 'inherit',
              borderRadius: 2,
              padding: '0 1px',
            }}
          >
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
  result,
  selected,
  query,
  onSelect,
  onExecute,
  onRestore,
}: Props) {
  const isHistory = result.type === 'history';
  const isBlock = result.type === 'block';
  const isSession = result.type === 'session';

  const blockData = isBlock ? (result.data as BlockResultData) : null;
  const sessionData = isSession ? (result.data as SessionResultData) : null;
  const isHistoricalBlock = isBlock && blockData?.sessionStatus === 'historical';
  const isHistoricalSession = isSession && sessionData?.status === 'historical';
  const borderColor = blockData
    ? blockData.exitCode === 0
      ? 'var(--success)'
      : 'var(--error)'
    : 'transparent';

  return (
    <div
      onClick={(e) => {
        // 历史会话/块：点击卡片 = 恢复（与 ↩ 按钮一致）
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
        padding: '10px 14px 8px',
        border: 'none',
        borderLeft: isBlock ? `3px solid ${borderColor}` : '3px solid transparent',
        background: selected ? 'var(--accent-bg)' : 'transparent',
        color: 'var(--text-primary)',
        cursor: 'pointer',
        fontSize: 12,
        fontFamily: 'var(--font-ui)',
        transition: 'background 0.1s',
        position: 'relative',
      }}
    >
      {/* 类型图标 */}
      <span
        style={{
          flexShrink: 0,
          width: 20,
          marginTop: 1,
          display: 'inline-flex',
          justifyContent: 'center',
          color: 'var(--text-muted)',
        }}
      >
        {(() => {
          const Icon = typeIcon(result);
          return <Icon size={13} />;
        })()}
      </span>

      {/* 内容 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* 主标题 */}
        <div
          style={{
            fontWeight: 600,
            fontSize: 12.5,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: isHistory ? 'var(--font-mono)' : undefined,
          }}
        >
          {query ? <HighlightedText text={result.title} query={query} /> : result.title}
        </div>

        {/* 副标题 — 输出片段，带高亮 */}
        {result.subtitle && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: isBlock ? 'normal' : 'nowrap',
              fontFamily: isBlock ? 'var(--font-mono)' : undefined,
              maxHeight: isBlock ? 32 : undefined,
              lineHeight: 1.4,
            }}
          >
            {query ? <HighlightedText text={result.subtitle} query={query} /> : result.subtitle}
          </div>
        )}

        {/* 第三行：detail + badge */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 3,
            fontSize: 10,
            color: 'var(--text-muted)',
          }}
        >
          {result.detail && <span>{result.detail}</span>}
          {isBlock && blockData?.status && !isHistoricalBlock && (
            <span
              style={{
                fontSize: 9,
                padding: '1px 5px',
                borderRadius: 3,
                background:
                  blockData.status === 'completed'
                    ? 'var(--success-bg)'
                    : blockData.status === 'failed'
                      ? 'var(--error-bg)'
                      : 'var(--accent-bg)',
                color:
                  blockData.status === 'completed'
                    ? 'var(--success)'
                    : blockData.status === 'failed'
                      ? 'var(--error)'
                      : 'var(--accent)',
              }}
            >
              {statusLabel(blockData.status)}
            </span>
          )}
          {/* 历史会话徽章 */}
          {(isHistoricalBlock || isHistoricalSession) && (
            <span
              style={{
                fontSize: 9,
                padding: '1px 5px',
                borderRadius: 3,
                background: 'var(--accent-warm-dim)',
                color: 'var(--accent-warm)',
              }}
            >
              历史会话
            </span>
          )}
        </div>
      </div>

      {/* 恢复按钮（历史会话的块 或 历史会话本身） */}
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
    <button
      onClick={onClick}
      title="恢复此会话"
      style={{
        flexShrink: 0,
        width: 22,
        height: 22,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid var(--accent-warm)',
        borderRadius: 4,
        background: 'var(--accent-warm-dim)',
        color: 'var(--accent-warm)',
        cursor: 'pointer',
        fontSize: 10,
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
    </button>
  );
}

function typeIcon(result: SearchResult): LucideIcon {
  switch (result.type) {
    case 'history':
      return History;
    case 'block':
      return SquareTerminal;
    case 'file': {
      const d = result.data as FileResultData;
      return fileIcon(d.name, d.isDir);
    }
    case 'setting':
      return Settings;
    case 'action':
      return Command;
    case 'session':
      return Monitor;
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'running':
      return '运行中';
    case 'completed':
      return '完成';
    case 'failed':
      return '失败';
    default:
      return status;
  }
}
