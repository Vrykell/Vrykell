/**
 * TerminalBlockList —  block 卡片列表。
 *
 * 每块一张卡片（圆角 + 浅底）：头部行内是加粗命令，右侧退出码/耗时，
 * hover 浮出操作按钮；输出在卡片内下方。
 * cwd/git 不在 block 顶部重复告知（底部输入栏已有 cwd）。
 */

import {
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Ellipsis,
  Maximize2,
  RotateCw,
  Skull,
  Sparkles,
  Square,
  Terminal,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToastStore } from '@/components/Toast';
import { fmtDuration } from '@/components/UiBtn';
import { agentControl } from '@/features/agent/agentControl';
import AiBlock from '@/features/chat/AiBlock';
import { mergeFlow, toExchanges } from '@/features/chat/exchanges';
import BlockMenu from '@/features/terminal/BlockMenu';
import BlockOutput from '@/features/terminal/BlockOutput';
import type { TermBlock } from '@/features/terminal/pipeline/termBlock';
import {
  applyCompactCharSize,
  getExecutingTerm,
  syncTermWidth,
} from '@/features/terminal/useTerminalSession';
import { killForeground } from '@/services/tauri/killForeground';
import { ptyWrite } from '@/services/tauri/pty';
import { getCellMetrics } from '@/services/tauri/termMetrics';
import { selectBlocks, useBlockStore } from '@/store/blocks';
import { useChatStore, usePaneMessages } from '@/store/chat';
import { useChatPanelOpen } from '@/store/dock';
import { useSearchHighlightStore } from '@/store/searchHighlight';
import { useTerminalStore } from '@/store/terminal';

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
  return b.status === 'executing' || b.command !== '' || b.outputHtml !== '' || b.outputText !== '';
}

export default function TerminalBlockList({ tabId, insetLeft = 8, insetRight = 8 }: Props) {
  const blocks = useBlockStore(selectBlocks(tabId));
  const highlightQuery = useSearchHighlightStore((s) => s.query);
  const [menuBlock, setMenuBlock] = useState<{ block: TermBlock; rect: DOMRect } | null>(null);
  // 该 pane 的 AI 对话线（注意：本组件的 tabId prop 实际是 paneId）
  const aiMessages = usePaneMessages(tabId);
  // AI 面板打开时不再内联 —— 回答只在面板显示，避免两处重复
  const chatPanelOpen = useChatPanelOpen();

  // 按新 TermBlock 状态分组；pending 与空块不渲染（底部固定输入栏即提示符，
  // 空占位卡片只是视觉噪音 —— 「最下面有一个空行」）
  const completed = useMemo(
    () =>
      blocks.filter(
        (b) => (b.status === 'done' || b.status === 'interrupted') && hasVisibleContent(b),
      ),
    [blocks],
  );
  const running = useMemo(() => blocks.filter((b) => b.status === 'executing'), [blocks]);

  // AI 问答折叠为交换，与已完成命令块按时间归并（渲染层操作，不改管线）
  const exchanges = useMemo(
    () => (chatPanelOpen ? [] : toExchanges(aiMessages)),
    [aiMessages, chatPanelOpen],
  );
  // agent 发起的已完成块不独立出现 —— 它们内嵌在回答的 run_command 节点下。
  // 面板打开时回答不内联，块保持独立渲染（否则会整个不可见）。
  // 运行中块不过滤：执行期间留在列表底部提供实时输出视图，完成后「对接」进回答。
  const standalone = useMemo(
    () => (chatPanelOpen ? completed : completed.filter((b) => !agentControl.hasBlock(b.id))),
    [completed, chatPanelOpen],
  );
  const flow = useMemo(() => mergeFlow(standalone, exchanges), [standalone, exchanges]);

  if (flow.length === 0 && running.length === 0) return null;

  const allCollapsed = completed.length > 0 && completed.every((b) => b.collapsed);

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
            onMenu={(block, rect) => setMenuBlock({ block, rect })}
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
          onClose={() => setMenuBlock(null)}
          getOutputText={() =>
            menuBlock.block.outputText || menuBlock.block.outputRaw.replace(ANSI_CSI_RE, '')
          }
        />
      )}
    </>
  );
}

// ══════ 工具：搜索高亮 ══════

function highlightFragments(text: string, query: string): Array<{ text: string; hl: boolean }> {
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
  const pattern =
    /(--?[a-zA-Z0-9][a-zA-Z0-9_.-]*|\.?\/[\w./-]+|[|&;]|[<>]{1,2}|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(cmd)) !== null) {
    if (m.index > last) parts.push(cmd.slice(last, m.index));
    const token = m[0];
    let color = 'var(--block-cmd-text)';
    if (token.startsWith('-')) color = 'var(--cmd-flag)';
    else if (token.startsWith('/') || token.startsWith('./') || token.startsWith('~/'))
      color = 'var(--cmd-path)';
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
  const isCollapsed = !!block.collapsed;
  const send = useChatStore((s) => s.send);
  const failed = block.exitCode !== null && block.exitCode !== 0;
  const duration =
    block.endedAt && block.startedAt ? fmtDuration(block.endedAt - block.startedAt) : '';

  const coloredCommand = useMemo(() => highlightCommand(block.command), [block.command]);

  // copyOut 优先用 outputText，回退到剥离 CSI 的 outputRaw
  const copyOutput = block.outputText || block.outputRaw.replace(ANSI_CSI_RE, '');

  const rerun = useCallback(() => {
    const sid = useTerminalStore.getState().sessions[tabId];
    if (sid) ptyWrite(sid, block.command + '\n').catch(() => {});
  }, [block.command, tabId]);

  const askAI = useCallback(() => {
    const plain = copyOutput.slice(0, 2000);
    // tabId prop 即 paneId：问答内联进本 pane 的块流
    send(`解释:\n\`\`\`\n${block.command}\n${plain}\n\`\`\``, { paneId: tabId });
  }, [block, copyOutput, send, tabId]);

  const copyCmd = useCallback(
    () => navigator.clipboard.writeText(block.command).catch(() => {}),
    [block.command],
  );
  const copyOut = useCallback(() => {
    navigator.clipboard.writeText(copyOutput).catch(() => {});
  }, [copyOutput]);

  return (
    <div
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
        // 阻止冒泡到 pane 级右键菜单，避免命令块菜单与终端菜单叠加出现
        e.stopPropagation();
        onMenu(block, e.currentTarget.getBoundingClientRect());
      }}
    >
      {/* 头部行：折叠 chevron + 加粗命令（行内）+ 右侧退出码/耗时，hover 浮出操作 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          userSelect: 'none',
          minHeight: 30,
        }}
      >
        <button
          onClick={() => useBlockStore.getState().setBlockCollapsed(tabId, block.id, !isCollapsed)}
          title={isCollapsed ? '展开' : '折叠'}
          style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: 0,
            width: 14,
            flexShrink: 0,
            display: 'inline-flex',
          }}
        >
          {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </button>
        <div
          data-selectable
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            fontWeight: 600,
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-primary)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            userSelect: 'text',
          }}
        >
          {highlightQuery ? (
            <HighlightSpan text={block.command} query={highlightQuery} />
          ) : (
            coloredCommand
          )}
        </div>
        {hovered ? (
          <span style={{ display: 'inline-flex', gap: 2, flexShrink: 0 }}>
            <BlockToolBtn title="AI 解释" onClick={askAI} label={<Sparkles size={12} />} />
            <BlockToolBtn title="重新运行" onClick={rerun} label={<RotateCw size={12} />} />
            <BlockToolBtn title="复制命令" onClick={copyCmd} label={<Terminal size={12} />} />
            <BlockToolBtn title="复制输出" onClick={copyOut} label={<Copy size={12} />} />
            <BlockToolBtn
              title={block.bookmarked ? '取消书签' : '添加书签'}
              onClick={() => useBlockStore.getState().toggleBookmark(tabId, block.id)}
              label={<Bookmark size={12} fill={block.bookmarked ? 'currentColor' : 'none'} />}
            />
            <BlockToolBtn
              title="更多操作"
              onClick={(e) => onMenu(block, (e.target as HTMLElement).getBoundingClientRect())}
              label={<Ellipsis size={12} />}
            />
          </span>
        ) : (
          <span
            style={{
              display: 'inline-flex',
              gap: 8,
              alignItems: 'center',
              flexShrink: 0,
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-muted)',
            }}
          >
            {block.agent && (
              <Zap size={11} style={{ color: 'var(--accent-warm)' }} aria-label="AI 执行" />
            )}
            {block.bookmarked && <Bookmark size={11} fill="currentColor" />}
            {block.exitCode !== null && (
              <span
                data-testid="exit-code"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 2,
                  color: failed ? 'var(--error)' : 'var(--success)',
                }}
              >
                {failed ? <X size={11} /> : <Check size={11} />}
                {block.exitCode}
              </span>
            )}
            {duration && <span style={{ fontVariantNumeric: 'tabular-nums' }}>({duration})</span>}
          </span>
        )}
      </div>

      {/* 输出：outputHtml 恒为 HTML（可能无 <span），显式 isHtml 分流 */}
      {!isCollapsed &&
        (block.outputHtml ? (
          <BlockOutput text={block.outputHtml} isHtml highlight={highlightQuery || undefined} />
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
  const sessions = useTerminalStore((s) => s.sessions);
  const setAltScreenActive = useTerminalStore((s) => s.setAltScreenActive);
  const setScene = useTerminalStore((s) => s.setScene);

  useEffect(() => {
    const timer = setInterval(() => {
      if (block.startedAt) setElapsedNow(fmtDuration(Date.now() - block.startedAt));
    }, 1000);
    return () => clearInterval(timer);
  }, [block.startedAt]);

  const sendCtrlC = useCallback(() => {
    const sid = sessions[tabId];
    if (sid) ptyWrite(sid, '\x03').catch(() => {});
  }, [sessions, tabId]);

  // 升级式结束：首击 SIGTERM，3 秒内再击 SIGKILL（应对忽略 Ctrl+C 的应用）
  const killApp = useCallback(() => {
    const sid = sessions[tabId];
    if (!sid) return;
    killForeground(sid).catch((e) => {
      useToastStore.getState().addToast(String((e as Error)?.message ?? e), 'info');
    });
  }, [sessions, tabId]);

  const enterTui = useCallback(() => {
    setScene(tabId, 'altScreen');
    setAltScreenActive(true);
  }, [setScene, setAltScreenActive, tabId]);

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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          userSelect: 'none',
          minHeight: 30,
        }}
      >
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
        <div
          data-selectable
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            fontWeight: 600,
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-primary)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            userSelect: 'text',
          }}
        >
          {highlightQuery ? (
            <HighlightSpan text={block.command} query={highlightQuery} />
          ) : (
            coloredCommand
          )}
        </div>
        <span
          style={{
            display: 'inline-flex',
            gap: 8,
            alignItems: 'center',
            flexShrink: 0,
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-muted)',
          }}
        >
          {block.agent && (
            <Zap size={11} style={{ color: 'var(--accent-warm)' }} aria-label="AI 执行" />
          )}
          {elapsedNow && <span style={{ fontVariantNumeric: 'tabular-nums' }}>({elapsedNow})</span>}
          <BlockToolBtn
            title="终止命令 (Ctrl+C)"
            onClick={sendCtrlC}
            label={<Square size={10} fill="currentColor" />}
          />
          <BlockToolBtn
            title="结束前台应用（SIGTERM；3 秒内再点强杀 SIGKILL）"
            onClick={killApp}
            label={<Skull size={11} />}
          />
          <BlockToolBtn title="进入全屏交互" onClick={enterTui} label={<Maximize2 size={12} />} />
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
  // 手动全屏（「进入全屏交互」）：el 搬进全屏宿主铺满；退出时搬回卡片
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
    if (tuiFs) {
      el.style.height = '100%'; // 全屏：不裁剪，完整行数可见
      term.focus(); // 主 xterm 已隐藏，键盘落点交给块终端
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
    term.attachCustomKeyEventHandler((e) => !(e.type === 'keydown' && e.key === 'End'));
    // 滚轮：卡片内不消费 wheel —— return false 让 xterm 跳过自家处理，
    // 事件继续冒泡到块列表的 DOM 滚动容器（否则滚轮落在运行中卡片上时整页滚不动）。
    // 全屏时交回 xterm 默认（normal buffer 滚自己的 scrollback）。
    term.attachCustomWheelEventHandler(() => tuiFs);
    // 卡片宿主宽度变化（出现/滚动条挤占/侧栏拖拽）→ 校核 PTY 与块终端列数
    //（blockList 场景下宽度跟随卡片内容宽，见 useTerminalSession.applyWidth）。
    // ResizeObserver 在 observe 时立即回调一次，兼作挂载时的首次校核。
    const widthRo = new ResizeObserver(() => syncTermWidth(tabId));
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
