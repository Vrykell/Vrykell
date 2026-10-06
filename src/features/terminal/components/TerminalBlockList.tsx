/**
 * TerminalBlockList renders command output as a continuous stream with thin separators.
 * Each command keeps its status and actions in a compact header above its output.
 */

import { memo, useState, useMemo, useEffect, useRef } from 'react';
import {
  Check, ChevronDown, ChevronRight, Copy, Ellipsis,
  CircleX, Maximize2, RotateCw, Sparkles, Square, Terminal, X, Zap,
} from '@ui/icons';
import { useBlockStore } from '@features/terminal';
import { useTerminalStore } from '@features/terminal';
import AiBlock from '@features/chat/components/AiBlock';
import { ptyResize, ptyWrite } from '@platform/pty';
import { fmtDuration } from '@ui/UiBtn';
import { getCellMetrics } from '@utils/termMetrics';
import { getExecutingTerm, resizeExecutingTerm, syncTermWidth } from '@features/terminal/hooks/useTerminalSession';
import { isTerminalDebugEnabled, terminalDebug } from '@features/terminal/services/terminalDebug';
import BlockMenu from '@features/terminal/components/BlockMenu';
import BlockOutput from '@features/terminal/components/BlockOutput';
import type { TermBlock } from '@features/terminal/services/pipeline/termBlock';
import { useTerminalBlockFlow } from '@features/terminal/hooks/useTerminalBlockFlow';
import type { BlockMenuAnchor } from '@features/terminal/hooks/useTerminalBlockFlow';
import { useBlockItemActions } from '@features/terminal/hooks/useBlockItemActions';
import { useTuiControls } from '@features/terminal/hooks/useTuiControls';
import { hasVisibleContent as hasVisibleBlockContent } from '@features/terminal/model/blockVisibility';
import { copyTerminalSelection, pasteClipboardIntoTerminal } from '@features/terminal/services/terminalClipboard';
import { TERMINAL_FONT_FAMILY } from '@features/terminal/model/terminalFont';
import { measureRunningTerminalRows } from '../model/runningTerminalRows';

interface Props {
  tabId: string;
  /** 命令块左右内边距（px），分屏时靠相邻终端一侧减半，让缝隙看起来像一个终端 */
  insetLeft?: number;
  insetRight?: number;
}

/** 从 ANSI CSI 序列剥离（OSC 已在 dispatcher 剥离）。 */
const ANSI_CSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g;
const BLOCK_ACTION_BUTTON_SIZE = 28;
const BLOCK_ACTION_ICON_SIZE = 14;
const BLOCK_COLLAPSE_ICON_SIZE = 12;

/** block 是否有值得渲染的内容（pending 占位、连按回车产生的空 done 都不算）。 */
export function hasVisibleContent(b: TermBlock): boolean {
  return hasVisibleBlockContent(b);
}

export default function TerminalBlockList({ tabId, insetLeft = 8, insetRight = 8 }: Props) {
  const {
    highlightQuery,
    completed,
    running,
    flow,
    allCollapsed,
    menuBlock,
    openMenu,
    closeMenu,
  } = useTerminalBlockFlow(tabId);

  if (flow.length === 0 && running.length === 0) return null;

  return (
    <>
      {/* 折叠/展开全部按钮 */}
      {completed.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '2px 8px' }}>
          <button
            onClick={() => useBlockStore.getState().setAllCollapsed(tabId, !allCollapsed)}
            title={allCollapsed ? '展开全部' : '折叠全部'}
            style={{
              fontSize: 'calc(10px * var(--ui-font-scale))',
              padding: '1px 8px',
              border: 'none',
              borderRadius: 3,
              background: 'transparent',
              color: 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            {allCollapsed ? '展开全部' : '折叠全部'}
          </button>
        </div>
      )}

      {/* 已完成块 + AI 问答（按时间交错） */}
      {flow.map((item, index) =>
        item.type === 'block' ? (
          <BlockItem
            key={item.block.id}
            block={item.block}
            tabId={tabId}
            insetLeft={insetLeft}
            insetRight={insetRight}
            highlightQuery={highlightQuery}
            dividerBefore={index > 0}
            onMenu={openMenu}
          />
        ) : (
          <div key={item.exchange.id} style={{ padding: `0 ${insetRight}px 0 ${insetLeft}px` }}>
            <AiBlock exchange={item.exchange} />
          </div>
        ),
      )}

      {/* 运行中块 */}
      {running.map((b) => (
        <RunningItem
          key={b.id}
          block={b}
          tabId={tabId}
          insetLeft={insetLeft}
          insetRight={insetRight}
          highlightQuery={highlightQuery}
          dividerBefore={flow.length > 0}
        />
      ))}

      {/* 右键菜单 */}
      {menuBlock && (
        <BlockMenu
          block={menuBlock.block}
          paneId={tabId}
          anchor={menuBlock.anchor}
          onClose={closeMenu}
          getOutputText={() =>
            menuBlock.block.outputText ||
            menuBlock.block.outputRaw.replace(ANSI_CSI_RE, '')
          }
        />
      )}
    </>
  );
}

// ══════ 工具：搜索高亮 ══════

function highlightFragments(
  text: string,
  query: string,
): Array<{ text: string; hl: boolean }> {
  if (!query || query.length < 2 || !text) return [{ text, hl: false }];
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

function HighlightSpan({ text, query }: { text: string; query: string }) {
  const frags = highlightFragments(text, query);
  if (frags.length === 1 && !frags[0]!.hl) return <>{text}</>;
  return (
    <>
      {frags.map((f, i) =>
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

// ══════ 命令语法高亮（） ══════

/** 将命令文本中的 flag、路径、管道等按 着色 */
function highlightCommand(cmd: string): React.ReactNode {
  if (!cmd) return cmd;
  // 按 token 分割：flag(--xxx 或 -x)、路径(/xxx/yyy 或 ./xxx)、管道(|)、重定向(>/>>)、引号字符串
  const pattern = /(--?[a-zA-Z0-9][a-zA-Z0-9_.-]*|\.?\/[\w./-]+|[|&;]|[<>]{1,2}|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(cmd)) !== null) {
    if (m.index > last) parts.push(cmd.slice(last, m.index));
    const token = m[0];
    let color = 'var(--block-cmd-text)';
    if (token.startsWith('-')) color = 'var(--cmd-flag)';
    else if (token.startsWith('/') || token.startsWith('./') || token.startsWith('~/')) color = 'var(--cmd-path)';
    else if (token === '|') color = 'var(--cmd-pipe)';
    else if (token === '>' || token === '>>' || token === '<') color = 'var(--cmd-redirect)';
    else if (token.startsWith('"') || token.startsWith("'")) color = 'var(--cmd-string)';
    else if (token === '&' || token === ';') color = 'var(--cmd-pipe)';
    parts.push(
      <span key={m.index} style={{ color }}>
        {token}
      </span>,
    );
    last = m.index + token.length;
  }
  if (last < cmd.length) parts.push(cmd.slice(last));
  return parts.length > 0 ? <>{parts}</> : cmd;
}

// ══════ BlockItem（已完成 block） ══════

const BlockItem = memo(function BlockItem({
  block,
  tabId,
  insetLeft,
  insetRight,
  highlightQuery,
  dividerBefore,
  onMenu,
}: {
  block: TermBlock;
  tabId: string;
  insetLeft: number;
  insetRight: number;
  highlightQuery: string;
  dividerBefore: boolean;
  onMenu: (b: TermBlock, anchor: BlockMenuAnchor) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const {
    isCollapsed,
    copiedAction,
    rerun,
    askAI,
    copyCmd,
    copyOut,
    toggleCollapsed,
  } = useBlockItemActions({ tabId, block });
  const failed = block.exitCode !== null && block.exitCode !== 0;
  const duration =
    block.endedAt && block.startedAt ? fmtDuration(block.endedAt - block.startedAt) : '';

  const coloredCommand = useMemo(() => highlightCommand(block.command), [block.command]);

  return (
    <div
      data-testid={`command-block-${block.id}`}
      style={{
        paddingLeft: insetLeft,
        paddingRight: insetRight,
        borderTop: dividerBefore ? '1px solid var(--block-divider)' : 'none',
        paddingTop: dividerBefore ? 4 : 0,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={(e) => {
        e.preventDefault();
        // Keep the block menu separate from the pane-level context menu.
        e.stopPropagation();
        onMenu(block, { kind: 'pointer', x: e.clientX, y: e.clientY });
      }}
    >
      {/* The compact header keeps the command, result, duration, and hover actions together. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
        padding: '6px 10px', userSelect: 'none', minHeight: 44,
      }}>
        <button
          onClick={toggleCollapsed}
          title={isCollapsed ? '展开' : '折叠'}
          style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)',
            cursor: 'pointer', padding: 0, width: BLOCK_ACTION_BUTTON_SIZE, height: BLOCK_ACTION_BUTTON_SIZE, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          {isCollapsed ? <ChevronRight size={BLOCK_COLLAPSE_ICON_SIZE} /> : <ChevronDown size={BLOCK_COLLAPSE_ICON_SIZE} />}
        </button>
        <div data-selectable style={{
          flex: 1, minWidth: 0, fontSize: 'var(--terminal-font-size)', fontWeight: 600,
          fontFamily: TERMINAL_FONT_FAMILY, color: 'var(--text-primary)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-all', userSelect: 'text',
        }}>
          {highlightQuery ? <HighlightSpan text={block.command} query={highlightQuery} /> : coloredCommand}
        </div>
        {hovered ? (
          <span style={{ display: 'inline-flex', gap: 0, flexShrink: 0 }}>
            <BlockToolBtn title="AI 解释" onClick={askAI} label={<Sparkles size={BLOCK_ACTION_ICON_SIZE} />} />
            <BlockToolBtn title="重新运行" onClick={rerun} label={<RotateCw size={BLOCK_ACTION_ICON_SIZE} />} />
            <BlockToolBtn
              title="复制命令"
              onClick={copyCmd}
              label={copiedAction === 'command'
                ? <Check size={BLOCK_ACTION_ICON_SIZE} data-testid="copy-command-success" />
                : <Terminal size={BLOCK_ACTION_ICON_SIZE} />}
            />
            <BlockToolBtn
              title="复制输出"
              onClick={copyOut}
              label={copiedAction === 'output'
                ? <Check size={BLOCK_ACTION_ICON_SIZE} data-testid="copy-output-success" />
                : <Copy size={BLOCK_ACTION_ICON_SIZE} />}
            />
            <BlockToolBtn title="更多操作"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                onMenu(block, { kind: 'control', left: rect.left, top: rect.bottom + 4 });
              }}
              label={<Ellipsis size={BLOCK_ACTION_ICON_SIZE} />} />
          </span>
        ) : (
          <span style={{
            display: 'inline-flex', gap: 8, alignItems: 'center', flexShrink: 0,
            fontSize: 'calc(11px * var(--ui-font-scale))', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
          }}>
            {block.agent && <Zap size={11} style={{ color: 'var(--accent-warm)' }} aria-label="AI 执行" />}
            {block.exitCode !== null && (
              <span
                data-testid="exit-code"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 2,
                  color: failed ? 'var(--error)' : 'var(--success)',
                }}
              >
                {failed ? <X size={11} /> : <Check size={11} />}{block.exitCode}
              </span>
            )}
            {duration && <span style={{ fontVariantNumeric: 'tabular-nums' }}>({duration})</span>}
          </span>
        )}
      </div>

      {/* Route outputHtml explicitly because snapshots may contain plain text without spans. */}
      {!isCollapsed && (block.outputHtml ? (
        <BlockOutput
          text={block.outputHtml}
          isHtml
          highlight={highlightQuery || undefined}
        />
      ) : block.outputText ? (
        <BlockOutput
          text={block.outputText}
          isHtml={false}
          highlight={highlightQuery || undefined}
        />
      ) : null)}

      {/* Show when older output lines were truncated. */}
      {!isCollapsed && block.linesTruncated > 0 && (
        <div style={{ padding: '0 12px 6px 30px', fontSize: 'calc(10px * var(--ui-font-scale))', color: 'var(--text-muted)' }}>
          …已截断 {block.linesTruncated} 行
        </div>
      )}
    </div>
  );
});

// ══════ RunningItem（运行中 block） ══════

function RunningItem({
  block,
  tabId,
  insetLeft,
  insetRight,
  highlightQuery,
  dividerBefore,
}: {
  block: TermBlock;
  tabId: string;
  insetLeft: number;
  insetRight: number;
  highlightQuery: string;
  dividerBefore: boolean;
}) {
  const [elapsedNow, setElapsedNow] = useState(
    block.startedAt ? fmtDuration(Date.now() - block.startedAt) : '',
  );
  const { sendCtrlC, killApp, killArmed, enterFullScreen } = useTuiControls(tabId);

  useEffect(() => {
    const timer = setInterval(() => {
      if (block.startedAt) setElapsedNow(fmtDuration(Date.now() - block.startedAt));
    }, 1000);
    return () => clearInterval(timer);
  }, [block.startedAt]);

  const coloredCommand = useMemo(() => highlightCommand(block.command || ''), [block.command]);

  return (
    <div
      data-testid={`running-block-${block.id}`}
      style={{
        paddingLeft: insetLeft,
        paddingRight: insetRight,
        borderTop: dividerBefore ? '1px solid var(--block-divider)' : 'none',
        paddingTop: dividerBefore ? 4 : 0,
      }}
    >
      {/* The running header keeps the command, elapsed time, and controls together. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
        padding: '6px 10px', userSelect: 'none', minHeight: 44,
      }}>
        <span
          style={{
            display: 'inline-block',
            width: 7,
            height: 7,
            margin: '0 3.5px',
            borderRadius: '50%',
            background: 'var(--accent-warm)',
            animation: 'pulse 1.5s ease-in-out infinite',
            flexShrink: 0,
          }}
        />
        <div data-selectable style={{
          flex: 1, minWidth: 0, fontSize: 'var(--terminal-font-size)', fontWeight: 600,
          fontFamily: TERMINAL_FONT_FAMILY, color: 'var(--text-primary)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-all', userSelect: 'text',
        }}>
          {highlightQuery ? <HighlightSpan text={block.command} query={highlightQuery} /> : coloredCommand}
        </div>
        <span style={{
          display: 'inline-flex', gap: 2, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap', maxWidth: '100%',
          fontSize: 'calc(11px * var(--ui-font-scale))', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
        }}>
          {block.agent && <Zap size={11} style={{ color: 'var(--accent-warm)' }} aria-label="AI 执行" />}
          {elapsedNow && (
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>({elapsedNow})</span>
          )}
          <BlockToolBtn title="终止命令 (Ctrl+C)" onClick={sendCtrlC} label={<Square size={BLOCK_ACTION_ICON_SIZE} />} />
          <BlockToolBtn title={killArmed ? '强制结束前台应用（SIGKILL）' : '结束前台应用（SIGTERM；3 秒内再点强杀 SIGKILL）'} onClick={killApp} label={<CircleX size={BLOCK_ACTION_ICON_SIZE} />} />
          <BlockToolBtn title="进入全屏交互" onClick={enterFullScreen} label={<Maximize2 size={BLOCK_ACTION_ICON_SIZE} />} />
        </span>
      </div>

      {/* Live xterm preserves native cursor, IME, and CJK layout while the command runs. */}
      <RunningTerm tabId={tabId} blockId={block.id} />
    </div>
  );
}

// ══════ RunningTerm — 运行中块的活 xterm 宿主 ══════

/**
 * Mount the controller-owned live terminal, trim it to visible output, and connect input.
 * The controller owns the terminal lifecycle; this component only manages subscriptions.
 */
function RunningTerm({ tabId, blockId }: { tabId: string; blockId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const occupiedRowsRef = useRef(1);
  // Move the live terminal into the fullscreen host when manually activated.
  const tuiFs = useTerminalStore(
    (s) => s.altScreenActive && (s.scenes[tabId] ?? 'classic') === 'altScreen',
  );

  useEffect(() => {
    const handle = getExecutingTerm(tabId);
    if (!handle) {
      if (isTerminalDebugEnabled()) {
        terminalDebug('running-terminal-mount-missing', { tabId, blockId });
      }
      return;
    }
    const { term, el } = handle;
    const host = tuiFs
      ? document.querySelector<HTMLElement>('[data-testid="tui-fullscreen"]')
      : hostRef.current;
    if (!host) {
      if (isTerminalDebugEnabled()) {
        terminalDebug('running-terminal-host-missing', { tabId, blockId, fullscreen: tuiFs });
      }
      return;
    }

    host.appendChild(el);
    if (!term.element) term.open(el); // 重复挂载（StrictMode/切标签返回）只搬 el
    if (isTerminalDebugEnabled()) {
      terminalDebug('running-terminal-mounted', {
        tabId,
        blockId,
        fullscreen: tuiFs,
        hostWidth: host.clientWidth,
        hostVisible: host.getClientRects().length > 0,
      });
    }
    // e2e 测试桥：块终端 buffer 也进注册表（WebGL 下文本不进 DOM，测试读 buffer 断言）
    const w = window as unknown as { __vrykellTerms?: Map<string, unknown> };
    w.__vrykellTerms?.set(`block:${tabId}`, term);

    // Preserve occupied space across partial clear-and-repaint frames.
    const cellHeight = (): number => getCellMetrics(term).height;
    let visibleOutputLogged = false;
    const updateHeight = () => {
      const visible = measureRunningTerminalRows(term.buffer.active, term.rows, occupiedRowsRef.current);
      occupiedRowsRef.current = visible;
      // The xterm element has 4px of vertical padding on each side.
      el.style.height = `${visible * cellHeight() + 8}px`;
      if (!visibleOutputLogged && visible > 1 && isTerminalDebugEnabled()) {
        visibleOutputLogged = true;
        terminalDebug('running-terminal-output-visible', { tabId, blockId, rows: visible });
      }
    };

    let renderSub: { dispose(): void } | null = null;
    const resizeFullscreen = () => {
      const screen = el.querySelector<HTMLElement>('.xterm-screen');
      if (!screen || term.cols <= 0 || term.rows <= 0) return;
      const rect = screen.getBoundingClientRect();
      const cellW = rect.width / term.cols;
      const cellH = rect.height / term.rows;
      if (cellW <= 0 || cellH <= 0) return;
      const cols = Math.max(2, Math.floor(host.clientWidth / cellW));
      const rows = Math.max(1, Math.floor(host.clientHeight / cellH));
      if (cols === term.cols && rows === term.rows) return;
      resizeExecutingTerm(tabId, cols, rows);
      const sid = useTerminalStore.getState().sessions[tabId];
      if (sid) ptyResize(sid, cols, rows).catch(() => {});
    };
    if (tuiFs) {
      el.style.height = '100%'; // 全屏：不裁剪，完整行数可见
      term.focus(); // 主 xterm 已隐藏，键盘落点交给块终端
      requestAnimationFrame(resizeFullscreen);
    } else {
      updateHeight();
      renderSub = term.onRender(updateHeight);
    }

    // 键盘：xterm 原生路径（IME 组合/退格/控制键全由 xterm 处理）
    const dataSub = term.onData((d) => {
      const sid = useTerminalStore.getState().sessions[tabId];
      if (!sid) return;
      if (isTerminalDebugEnabled()) {
        terminalDebug('running-terminal-input', { tabId, chars: d.length });
      }
      ptyWrite(sid, d).then(() => {
        if (isTerminalDebugEnabled()) {
          terminalDebug('running-terminal-input-write-complete', { tabId, chars: d.length });
        }
      }).catch((error) => {
        if (isTerminalDebugEnabled()) {
          terminalDebug('running-terminal-input-error', {
            tabId,
            errorType: error instanceof Error ? error.name : typeof error,
          });
        }
      });
    });
    // Ctrl+Shift+C/V 复制/粘贴；End 保留给「回到输入栏」（InputEditor 全局监听），不进 PTY。
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === 'c') {
          e.preventDefault();
          void copyTerminalSelection(term);
          return false;
        }
        if (key === 'v') {
          e.preventDefault();
          void pasteClipboardIntoTerminal(tabId);
          return false;
        }
      }
      return !(e.type === 'keydown' && e.key === 'End');
    });
    // Bubble wheel events to the block list; fullscreen mode keeps xterm scrollback behavior.
    term.attachCustomWheelEventHandler(() => tuiFs);
    // Recheck terminal columns when the host width changes, including its first layout.
    let lastHostWidth = -1;
    const widthRo = new ResizeObserver(() => {
      if (tuiFs) resizeFullscreen();
      else if (host.clientWidth > 0 && host.clientWidth !== lastHostWidth) {
        lastHostWidth = host.clientWidth;
        syncTermWidth(tabId);
      }
    });
    widthRo.observe(host);

    return () => {
      if (w.__vrykellTerms?.get(`block:${tabId}`) === term) {
        w.__vrykellTerms.delete(`block:${tabId}`);
      }
      renderSub?.dispose();
      dataSub.dispose();
      widthRo.disconnect();
    };
  }, [tabId, blockId, tuiFs]);

  return (
    <div
      ref={hostRef}
      data-testid="running-term"
      style={{ overflow: 'hidden', padding: '2px 8px 8px' }}
    />
  );
}

// ══════ BlockToolBtn — 小块操作按钮 ══════

function BlockToolBtn({
  title,
  onClick,
  label,
}: {
  title: string;
  onClick: (e: React.MouseEvent) => void;
  label: React.ReactNode;
}) {
  return (
    <button
      data-subtle
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: BLOCK_ACTION_BUTTON_SIZE,
        minWidth: BLOCK_ACTION_BUTTON_SIZE,
        height: BLOCK_ACTION_BUTTON_SIZE,
        padding: 0,
        gap: 0,
        border: 'none',
        borderRadius: 4,
        background: 'transparent',
        color: 'var(--text-muted)',
        fontSize: 'calc(12px * var(--ui-font-scale))',
        cursor: 'pointer',
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--button-hover)';
        e.currentTarget.style.color = 'var(--text-secondary)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--text-muted)';
      }}
    >
      {label}
    </button>
  );
}
