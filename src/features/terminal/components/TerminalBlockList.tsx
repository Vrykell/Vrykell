/**
 * TerminalBlockList —  block 卡片列表。
 *
 * 每块一张卡片（圆角 + 浅底）：头部行内是加粗命令，右侧退出码/耗时，
 * hover 浮出操作按钮；输出在卡片内下方。
 * cwd/git 不在 block 顶部重复告知（底部输入栏已有 cwd）。
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import {
  Bookmark, Check, ChevronDown, ChevronRight, Copy, Ellipsis,
  Maximize2, RotateCw, Skull, Sparkles, Square, Terminal, X, Zap,
} from 'lucide-react';
import { useBlockStore } from '@features/terminal';
import { useTerminalStore } from '@features/terminal';
import AiBlock from '@features/chat/components/AiBlock';
import { ptyResize, ptyWrite } from '@platform/pty';
import { fmtDuration } from '@ui/UiBtn';
import { getCellMetrics } from '@utils/termMetrics';
import { getExecutingTerm, syncTermWidth, applyCompactCharSize } from '@features/terminal/hooks/useTerminalSession';
import BlockMenu from '@features/terminal/components/BlockMenu';
import BlockOutput from '@features/terminal/components/BlockOutput';
import type { TermBlock } from '@features/terminal/services/pipeline/termBlock';
import { useTerminalBlockFlow } from '@features/terminal/hooks/useTerminalBlockFlow';
import { useBlockItemActions } from '@features/terminal/hooks/useBlockItemActions';
import { useTuiControls } from '@features/terminal/hooks/useTuiControls';
import { hasVisibleContent as hasVisibleBlockContent } from '@features/terminal/model/blockVisibility';
import { TERMINAL_FONT_FAMILY, TERMINAL_FONT_SIZE } from '@features/terminal/model/terminalFont';

interface Props {
  tabId: string;
  /** 命令块左右内边距（px），分屏时靠相邻终端一侧减半，让缝隙看起来像一个终端 */
  insetLeft?: number;
  insetRight?: number;
}

/** 从 ANSI CSI 序列剥离（OSC 已在 dispatcher 剥离）。 */
const ANSI_CSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g;

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
              fontSize: 10,
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
      {flow.map((item) =>
        item.type === 'block' ? (
          <BlockItem
            key={item.block.id}
            block={item.block}
            tabId={tabId}
            insetLeft={insetLeft}
            insetRight={insetRight}
            highlightQuery={highlightQuery}
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
        />
      ))}

      {/* 右键菜单 */}
      {menuBlock && (
        <BlockMenu
          block={menuBlock.block}
          paneId={tabId}
          anchor={menuBlock.rect}
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

function BlockItem({
  block,
  tabId,
  insetLeft,
  insetRight,
  highlightQuery,
  onMenu,
}: {
  block: TermBlock;
  tabId: string;
  insetLeft: number;
  insetRight: number;
  highlightQuery: string;
  onMenu: (b: TermBlock, rect: DOMRect) => void;
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
    toggleBookmark,
  } = useBlockItemActions({ tabId, block });
  const failed = block.exitCode !== null && block.exitCode !== 0;
  const duration =
    block.endedAt && block.startedAt ? fmtDuration(block.endedAt - block.startedAt) : '';

  const coloredCommand = useMemo(() => highlightCommand(block.command), [block.command]);

  return (
    <div
      data-testid={`command-block-${block.id}`}
      style={{
        margin: `4px ${insetRight}px 10px ${insetLeft}px`,
        borderRadius: 8,
        background: 'var(--block)',
        position: 'relative',
        overflow: 'hidden',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={(e) => {
        e.preventDefault();
        // Keep the block menu separate from the pane-level context menu.
        e.stopPropagation();
        onMenu(block, e.currentTarget.getBoundingClientRect());
      }}
    >
      {/* 头部行：折叠 chevron + 加粗命令（行内）+ 右侧退出码/耗时，hover 浮出操作 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 10px', userSelect: 'none', minHeight: 30,
      }}>
        <button
          onClick={toggleCollapsed}
          title={isCollapsed ? '展开' : '折叠'}
          style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)',
            cursor: 'pointer', padding: 0, width: 14, flexShrink: 0, display: 'inline-flex' }}>
          {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </button>
        <div data-selectable style={{
          flex: 1, minWidth: 0, fontSize: TERMINAL_FONT_SIZE, fontWeight: 600,
          fontFamily: TERMINAL_FONT_FAMILY, color: 'var(--text-primary)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-all', userSelect: 'text',
        }}>
          {highlightQuery ? <HighlightSpan text={block.command} query={highlightQuery} /> : coloredCommand}
        </div>
        {hovered ? (
          <span style={{ display: 'inline-flex', gap: 2, flexShrink: 0 }}>
            <BlockToolBtn title="AI 解释" onClick={askAI} label={<Sparkles size={12} />} />
            <BlockToolBtn title="重新运行" onClick={rerun} label={<RotateCw size={12} />} />
            <BlockToolBtn
              title="复制命令"
              onClick={copyCmd}
              label={copiedAction === 'command'
                ? <Check size={12} data-testid="copy-command-success" />
                : <Terminal size={12} />}
            />
            <BlockToolBtn
              title="复制输出"
              onClick={copyOut}
              label={copiedAction === 'output'
                ? <Check size={12} data-testid="copy-output-success" />
                : <Copy size={12} />}
            />
            <BlockToolBtn title={block.bookmarked ? '取消书签' : '添加书签'}
              onClick={toggleBookmark}
              label={<Bookmark size={12} fill={block.bookmarked ? 'currentColor' : 'none'} />} />
            <BlockToolBtn title="更多操作"
              onClick={(e) => onMenu(block, e.currentTarget.getBoundingClientRect())}
              label={<Ellipsis size={12} />} />
          </span>
        ) : (
          <span style={{
            display: 'inline-flex', gap: 8, alignItems: 'center', flexShrink: 0,
            fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
          }}>
            {block.agent && <Zap size={11} style={{ color: 'var(--accent-warm)' }} aria-label="AI 执行" />}
            {block.bookmarked && <Bookmark size={11} fill="currentColor" />}
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

      {/* 输出：outputHtml 恒为 HTML（可能无 <span），显式 isHtml 分流 */}
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

      {/* 截断提示 */}
      {!isCollapsed && block.linesTruncated > 0 && (
        <div style={{ padding: '0 12px 6px 30px', fontSize: 10, color: 'var(--text-muted)' }}>
          …已截断 {block.linesTruncated} 行
        </div>
      )}
    </div>
  );
}

// ══════ RunningItem（运行中 block） ══════

function RunningItem({
  block,
  tabId,
  insetLeft,
  insetRight,
  highlightQuery,
}: {
  block: TermBlock;
  tabId: string;
  insetLeft: number;
  insetRight: number;
  highlightQuery: string;
}) {
  const [elapsedNow, setElapsedNow] = useState(
    block.startedAt ? fmtDuration(Date.now() - block.startedAt) : '',
  );
  const { sendCtrlC, killApp, enterFullScreen } = useTuiControls(tabId);

  useEffect(() => {
    const timer = setInterval(() => {
      if (block.startedAt) setElapsedNow(fmtDuration(Date.now() - block.startedAt));
    }, 1000);
    return () => clearInterval(timer);
  }, [block.startedAt]);

  const coloredCommand = useMemo(() => highlightCommand(block.command || ''), [block.command]);

  return (
    <div
      style={{
        margin: `4px ${insetRight}px 10px ${insetLeft}px`,
        borderRadius: 8,
        background: 'var(--block)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* 头部行：脉冲点 + 加粗命令 + 耗时/操作按钮 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 10px', userSelect: 'none', minHeight: 30,
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
          flex: 1, minWidth: 0, fontSize: TERMINAL_FONT_SIZE, fontWeight: 600,
          fontFamily: TERMINAL_FONT_FAMILY, color: 'var(--text-primary)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-all', userSelect: 'text',
        }}>
          {highlightQuery ? <HighlightSpan text={block.command} query={highlightQuery} /> : coloredCommand}
        </div>
        <span style={{
          display: 'inline-flex', gap: 8, alignItems: 'center', flexShrink: 0,
          fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
        }}>
          {block.agent && <Zap size={11} style={{ color: 'var(--accent-warm)' }} aria-label="AI 执行" />}
          {elapsedNow && (
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>({elapsedNow})</span>
          )}
          <BlockToolBtn title="终止命令 (Ctrl+C)" onClick={sendCtrlC} label={<Square size={10} fill="currentColor" />} />
          <BlockToolBtn title="结束前台应用（SIGTERM；3 秒内再点强杀 SIGKILL）" onClick={killApp} label={<Skull size={11} />} />
          <BlockToolBtn title="进入全屏交互" onClick={enterFullScreen} label={<Maximize2 size={12} />} />
        </span>
      </div>

      {/* 实时输出：块内活 xterm（活终端栅格 —— 原生光标/IME/CJK 对齐，
          无 250ms 快照同步）。完成后由 BlockItem 渲染静态 HTML 快照 */}
      <RunningTerm tabId={tabId} />
    </div>
  );
}

// ══════ RunningTerm — 运行中块的活 xterm 宿主 ══════

/**
 * 挂载 controller 创建的块内活终端：移入卡片、open、按内容裁剪高度，
 * 并接键盘（onData → PTY，与 classic 同一条 xterm 原生输入路径）。
 * term 生命周期归 controller（块完成提取快照后 dispose），这里只断开订阅。
 */
function RunningTerm({ tabId }: { tabId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Move the live terminal into the fullscreen host when manually activated.
  const tuiFs = useTerminalStore(
    (s) => s.altScreenActive && (s.scenes[tabId] ?? 'classic') === 'altScreen',
  );

  useEffect(() => {
    const handle = getExecutingTerm(tabId);
    if (!handle) return;
    const { term, el } = handle;
    const host = tuiFs
      ? document.querySelector<HTMLElement>('[data-testid="tui-fullscreen"]')
      : hostRef.current;
    if (!host) return;

    host.appendChild(el);
    if (!term.element) term.open(el); // 重复挂载（StrictMode/切标签返回）只搬 el
    applyCompactCharSize(term); // 行高压到 fontSize（与主终端一致，半块字符无缝）
    // e2e 测试桥：块终端 buffer 也进注册表（WebGL 下文本不进 DOM，测试读 buffer 断言）
    const w = window as unknown as { __vrykellTerms?: Map<string, unknown> };
    if (w.__vrykellTerms && !w.__vrykellTerms.has(`block:${tabId}`)) {
      w.__vrykellTerms.set(`block:${tabId}`, term);
    }

    // 高度裁剪：term 行数恒 = 主 xterm/PTY 行数（TUI 几何一致），
    // 短输出裁掉尾部空白行 —— 内容高度 = 最后非空行（含光标行）× 行高。
    // 裁剪设在 el（xterm 外层，overflow:hidden）而非 host：host 的底部
    // padding 需要露出卡片底色作呼吸空间，裁 host 会让黑终端区吃满 padding。
    const cellHeight = (): number => getCellMetrics(term).height;
    const updateHeight = () => {
      const buf = term.buffer.active;
      let contentEnd = buf.baseY + buf.cursorY + 1;
      const bottom = Math.min(buf.baseY + term.rows, buf.length);
      for (let y = bottom - 1; y >= 0; y--) {
        const line = buf.getLine(y);
        if (line && line.translateToString(true).trim()) {
          contentEnd = Math.max(contentEnd, y + 1);
          break;
        }
      }
      const visible = Math.max(1, Math.min(contentEnd, term.rows));
      // +8 = .xterm 的垂直 padding（4px 上 + 4px 下，深色盒子的内侧呼吸边距）
      el.style.height = `${visible * cellHeight() + 8}px`;
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
      term.resize(cols, rows);
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
      if (sid) ptyWrite(sid, d).catch(() => {});
    });
    // End 保留给「回到输入栏」（InputEditor 全局监听），不进 PTY
    term.attachCustomKeyEventHandler(
      (e) => !(e.type === 'keydown' && e.key === 'End'),
    );
    // 滚轮：卡片内不消费 wheel —— return false 让 xterm 跳过自家处理，
    // 事件继续冒泡到块列表的 DOM 滚动容器（否则滚轮落在运行中卡片上时整页滚不动）。
    // 全屏时交回 xterm 默认（normal buffer 滚自己的 scrollback）。
    term.attachCustomWheelEventHandler(() => tuiFs);
    // 卡片宿主宽度变化（出现/滚动条挤占/侧栏拖拽）→ 校核 PTY 与块终端列数
    //（blockList 场景下宽度跟随卡片内容宽，见 useTerminalSession.applyWidth）。
    // ResizeObserver 在 observe 时立即回调一次，兼作挂载时的首次校核。
    const widthRo = new ResizeObserver(() => {
      if (tuiFs) resizeFullscreen();
      else syncTermWidth(tabId);
    });
    widthRo.observe(host);
    // 选中即复制（与主 xterm 一致）
    const selSub = term.onSelectionChange(() => {
      const sel = term.getSelection();
      if (sel) navigator.clipboard.writeText(sel).catch(() => {});
    });

    return () => {
      renderSub?.dispose();
      dataSub.dispose();
      selSub.dispose();
      widthRo.disconnect();
    };
  }, [tabId, tuiFs]);

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
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 22,
        height: 22,
        padding: 0,
        border: 'none',
        borderRadius: 4,
        background: 'transparent',
        color: 'var(--text-muted)',
        fontSize: 12,
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
