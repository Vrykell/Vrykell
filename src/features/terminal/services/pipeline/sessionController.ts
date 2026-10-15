import { resizeTerminal } from '../../model/terminalResize';
/**
 * SessionController — block 生命周期 + 三场景状态机（Spec §1-§3）。
 *
 * 同步消费 Rust 端扫描后的 DispatchEvent（扫描见 src-tauri/src/scan.rs）；每段输出只有一个目的地：
 *   blockList·pending    → activeBlock.earlyBuf
 *   blockList·executing  → activeBlock.outputTerm（块内活 xterm，RunningItem 挂载显示）
 *   classic / altScreen  → 主 xterm（OSC raw 也转发，保 OSC 8/52）
 */

import type { Terminal } from '@xterm/xterm';
import { createBlockTerm, extractSnapshotFromBuffer } from '@features/terminal/model/terminalSnapshot';
import type { DispatchEvent } from '@core/terminal/events';
import type { TermBlock, BlockStatus } from '@features/terminal/services/pipeline/termBlock';
import { isTerminalDebugEnabled, terminalDebug } from '@features/terminal/services/terminalDebug';
import { TerminalIoLog } from '@features/terminal/services/terminalIoLog';
import { workingDirectoryFromUri } from '@features/terminal/services/pipeline/workingDirectory';
import { trackBufferTruncation, type BufferTruncationTracker } from '@features/terminal/services/pipeline/bufferTruncation';
import { getTerminalFontSize, measureTerminalDomCellWidth } from '@features/terminal/model/terminalFont';
import { getCellMetrics } from '@utils/termMetrics';

export type Scene = 'classic' | 'blockList' | 'altScreen';

export interface SessionSinks {
  writeMain(data: string): void;
  onBlocksChanged(): void;
  onSceneChanged(scene: Scene): void;
  onCwd(path: string): void;
  onBlockStart(block: TermBlock): void;
  onBlockComplete(block: TermBlock): void;
  /** Window title a foreground program set via OSC 0/2 (empty = cleared). */
  onProgramTitle?(title: string): void;
  /** Keep terminal replies connected even before a running output view mounts. */
  onTerminalData?(data: string): void;
  takePendingUiCommand?(): string | null;
  clearPendingUiCommand?(): void;
}

const RAW_CAP = 256 * 1024;
const MAX_FULL_BLOCKS = 200;    // 超出丢弃最老 block 的输出，保留 header
const MAX_TOTAL_BLOCKS = 500;   // Hard cap for block history, including header-only entries.

interface InternalBlock extends TermBlock {
  outputTerm: Terminal | null;
  /** outputTerm 的隐藏宿主 div（RunningItem 挂载时移进卡片可见化） */
  outputEl: HTMLDivElement | null;
  _outputDispose: (() => void) | null;
  earlyBuf: string;
  _pendingCommandEcho: string | null;
  _commandEchoPrefixConsumed: boolean;
  _consumeCommandEchoTerminator: boolean;
  _truncationTracker: BufferTruncationTracker | null;
  _commandFromUi: boolean;
  /** 是否由 OSC 133;A 正常创建（用于决定 earlyBuf 是否含提示符行） */
  _fromA: boolean;
}

// block id 跨重启唯一（时间戳前缀 + 自增），避免重启后与历史块 id 碰撞
const BLOCK_PREFIX = Date.now().toString(36);
let nextId = 1;

export class SessionController {
  private _blocks: InternalBlock[] = [];
  private _scene: Scene;
  /** altScreen 进入前的场景（退出时恢复） */
  private preAltScene: Scene;
  /** 是否启用块系统：false = 经典模式（传统终端，输出直进 xterm，不建块） */
  private blockEnabled: boolean;
  private pendingUiCommand = '';
  private pendingShellCommand = '';
  private longRunningTimer: ReturnType<typeof setTimeout> | null = null;
  private _disposed = false;
  /** 最近一次 OSC 7 上报的 cwd：真实 RC 顺序是 OSC7 → D → A，新 block 以此播种 */
  private lastCwd: string | undefined;
  /** 当前前台程序设置的窗口标题（OSC 0/2）；空串=未设置，仅在程序占用终端时有效 */
  private programTitle = '';
  /** Pipeline counters of this pane; the session hook feeds the receive stage into the same window. */
  readonly ioLog: TerminalIoLog;

  constructor(
    private tabId: string,
    private cols: number,
    private sinks: SessionSinks,
    /** 块内活终端的行数（= 主 xterm/PTY 行数，TUI 几何一致的关键）；缺省 24 */
    private rows = 24,
    /** 初始场景（终端打开模式：classic 或 blockList）；缺省 classic */
    initialScene: Scene = 'classic',
    /** 块系统开关；false = 经典模式（传统终端） */
    blockEnabled = true,
  ) {
    this.ioLog = new TerminalIoLog(tabId);
    this._scene = initialScene;
    this.preAltScene = initialScene;
    this.blockEnabled = blockEnabled;
  }

  get scene(): Scene {
    return this._scene;
  }

  get blocks(): readonly TermBlock[] {
    return this._blocks;
  }

  get activeBlock(): InternalBlock | null {
    return this._blocks.length > 0 ? this._blocks[this._blocks.length - 1]! : null;
  }

  /** 运行中块的活终端（term + 隐藏宿主 el）；无 executing 块时为 null */
  get executingTerm(): { term: Terminal; el: HTMLDivElement } | null {
    const ab = this.activeBlock;
    if (ab?.status === 'executing' && ab.outputTerm && ab.outputEl) {
      return { term: ab.outputTerm, el: ab.outputEl };
    }
    return null;
  }

  // ── 事件入口 ──

  handleEvents(events: DispatchEvent[]): void {
    this.ioLog.consumed(events, this._scene);
    if (!this.blockEnabled) {
      // 经典模式：传统终端，所有输出直进主 xterm（不建块、不切场景、TUI 由 xterm 原生处理）
      for (const ev of events) {
        this.sinks.writeMain(ev.kind === 'data' ? ev.text : ev.raw);
      }
      return;
    }
    for (const ev of events) {
      switch (ev.kind) {
        case 'data':
          this.routeData(ev.text);
          break;
        case 'osc':
          this.handleOsc(ev.code, ev.payload, ev.raw);
          break;
        case 'altEnter':
          this.enterAlt(ev.raw);
          break;
        case 'altExit':
          this.exitAlt(ev.raw);
          break;
      }
    }
  }

  // ── 数据路由（唯一目的地） ──

  private routeData(text: string): void {
    if (this._scene === 'classic' || this._scene === 'altScreen') {
      this.ioLog.routed('main', text.length);
      this.sinks.writeMain(text);
      return;
    }
    let ab = this.activeBlock;
    if (!ab || (ab.status !== 'executing' && ab.status !== 'pending')) {
      // blockList 下没有活跃 block（如前一个已 done）：自动创建新 pending block 接孤儿输出
      this.onPrecmd(false);
      ab = this.activeBlock;
    }
    if (!ab) return;
    if (ab.status === 'executing') {
      const echoArmed = ab._pendingCommandEcho !== null;
      const output = this.stripCommandEcho(ab, text);
      this.ioLog.routed('block', text.length, {
        blockNotReady: ab.outputTerm === null,
        echoArmed,
        echoFiltered: !output,
      });
      if (!output) return;
      ab.outputTerm?.write(output);
      // Trim only after crossing 2× the cap to avoid repeated full-string copies.
      ab.outputRaw += output;
      if (ab.outputRaw.length > RAW_CAP * 2) {
        ab.outputRaw = ab.outputRaw.slice(-RAW_CAP);
      }
    } else {
      this.ioLog.routed('early', text.length, { blockNotReady: ab.outputTerm === null });
      ab.earlyBuf += text;
    }
  }

  // ── OSC 处理 ──

  private handleOsc(code: string, payload: string, raw: string): void {
    if (isTerminalDebugEnabled()) {
      terminalDebug('osc', { tabId: this.tabId, code, payloadLength: payload.length, rawLength: raw.length, scene: this._scene });
    }
    // OSC 0/2 is the window title a foreground program sets; reflect it while that program owns
    // the terminal so an animated TUI title (a spinner or running task) shows in the tab.
    if (code === '0' || code === '2') {
      const ownsTerminal = this.activeBlock?.status === 'executing' || this._scene === 'altScreen';
      this.setProgramTitle(ownsTerminal ? cleanProgramTitle(payload) : '');
    }
    // classic/altScreen：OSC raw 转发主 xterm（OSC 8 超链接等不失效）；
    // 但 133/7 是 integration 标记，永不进主 xterm。
    const isIntegration = code === '133;A' || code === '133;B' || code === '133;C' || code === '133;D'
      || code === '133;E' || code === '133;G' || code === '7';
    if (this._scene !== 'blockList' && !isIntegration) {
      this.sinks.writeMain(raw);
      return;
    }
    // Block list: the running command's own terminal is the block terminal, so OSC that is
    // not shell integration has to reach it. Colour and palette queries (OSC 10/11/12, OSC 4)
    // wait for the reply that only that terminal can give, and hyperlinks (OSC 8) and
    // clipboard (OSC 52) only take effect there. Dropping them made every TUI that probes the
    // terminal (a background-colour query at startup is common) misbehave.
    const running = this.activeBlock;
    if (this._scene === 'blockList' && !isIntegration && running?.status === 'executing' && running.outputTerm) {
      // Color replies need the terminal's theme service, which is created on open.
      // The detached host does not paint or take focus while a short command starts.
      if (!running.outputTerm.element && running.outputEl) running.outputTerm.open(running.outputEl);
      running.outputTerm.write(raw);
      running.outputRaw += raw;
      if (running.outputRaw.length > RAW_CAP * 2) {
        running.outputRaw = running.outputRaw.slice(-RAW_CAP);
      }
      return;
    }

    switch (code) {
      case '133;A':
        this.onPrecmd(true);
        break;
      case '133;E':
        this.onShellCommand(decodeB64(payload).trim());
        break;
      case '133;G': {
        const branch = decodeB64(payload).trim();
        const ab = this.activeBlock;
        if (branch && ab) {
          ab.gitBranch = branch;
          this.sinks.onBlocksChanged();
        }
        break;
      }
      case '133;C':
        this.onPreexec();
        break;
      case '133;D':
        this.onCommandDone(payload);
        break;
      case '7': {
        const path = workingDirectoryFromUri(payload);
        if (path !== undefined) {
          this.lastCwd = path;
          // OSC 7 常在 133;A 之前到达（真实 RC 顺序），此刻活跃 block 是刚结束的旧
          // block，不能把新 cwd 记到它头上；只有 pending（当前位置行）才同步更新。
          const ab = this.activeBlock;
          if (ab && ab.status === 'pending' && this._scene === 'blockList') {
            ab.cwd = path;
            this.sinks.onBlocksChanged();
          }
          this.sinks.onCwd(path);
        }
        break;
      }
      default:
        // Nothing is running (pending/done block): no terminal to answer it, so drop it.
        break;
    }
  }

  /** Record a program title and notify on change; an empty value clears it. */
  private setProgramTitle(title: string): void {
    if (this.programTitle === title) return;
    this.programTitle = title;
    if (isTerminalDebugEnabled()) {
      terminalDebug('program-title', { tabId: this.tabId, chars: title.length, scene: this._scene });
    }
    this.sinks.onProgramTitle?.(title);
  }

  // ── Block 生命周期（Spec §2） ──

  private onPrecmd(fromA = true): void {
    if (isTerminalDebugEnabled()) {
      terminalDebug('block-prompt-start', { tabId: this.tabId, scene: this._scene, previousStatus: this.activeBlock?.status ?? null });
    }
    // The prompt is back: any title the previous foreground program set no longer applies.
    this.setProgramTitle('');
    // 首个 A：classic → blockList
    if (this._scene === 'classic') {
      this._scene = 'blockList';
      this.sinks.onSceneChanged('blockList');
    }
    const prev = this.activeBlock;
    if (prev && (prev.status === 'executing' || prev.status === 'pending')) {
      // 无 D 直接 A（Ctrl+C 中断 / 空命令直接回车）
      if (prev.status === 'executing') {
        this.finishBlock(prev, null, 'interrupted');
      } else {
        // pending 空 block（连按回车）：status=done 无输出
        prev.status = 'done';
        prev.endedAt = Date.now();
      }
    }
    this.pendingUiCommand = '';
    this.pendingShellCommand = '';
    this.sinks.clearPendingUiCommand?.();
    const block: InternalBlock = {
      id: `b${BLOCK_PREFIX}-${nextId++}`,
      command: '',
      cwd: this.lastCwd,
      status: 'pending',
      exitCode: null,
      startedAt: null,
      endedAt: null,
      wasLongRunning: false,
      outputHtml: '',
      outputText: '',
      outputRaw: '',
      linesTruncated: 0,
      outputTerm: null,
      outputEl: null,
      _outputDispose: null,
      earlyBuf: '',
      _pendingCommandEcho: null,
      _commandEchoPrefixConsumed: false,
      _consumeCommandEchoTerminator: false,
      _truncationTracker: null,
      _commandFromUi: false,
      _fromA: fromA,
    };
    this._blocks.push(block);
    this.enforceBlockCap();
    this.sinks.onBlocksChanged();
  }

  private onPreexec(): void {
    const ab = this.activeBlock;
    if (!ab || ab.status !== 'pending') return;
    const controllerUiCommand = this.pendingUiCommand;
    const deferredUiCommand = this.sinks.takePendingUiCommand?.() ?? '';
    const uiCommand = controllerUiCommand || deferredUiCommand;
    const shellCommand = this.pendingShellCommand;
    const command = uiCommand || shellCommand;
    this.pendingUiCommand = '';
    this.pendingShellCommand = '';
    if (isTerminalDebugEnabled()) {
      terminalDebug('command-start', {
        tabId: this.tabId,
        blockId: ab.id,
        commandChars: command.length,
        commandSource: controllerUiCommand
          ? 'input-editor-controller'
          : deferredUiCommand
            ? 'input-editor-deferred'
            : shellCommand
              ? 'osc-133-e'
              : 'unavailable',
        earlyBufferChars: ab.earlyBuf.length,
      });
    }
    ab.command = command;
    ab._commandFromUi = Boolean(uiCommand);
    ab.startedAt = Date.now();
    ab.status = 'executing';
    ab._pendingCommandEcho = ab.command.split(/\r?\n/, 1)[0]?.trim() || null;
    ab._commandEchoPrefixConsumed = false;

    // 创建块内活终端（隐藏宿主，RunningItem 挂载后移入卡片可见化）
    const blk = createBlockTerm(this.cols, this.rows);
    ab.outputTerm = blk.term;
    ab.outputEl = blk.el;
    // Subscribe before the first write. UI mounting can follow a scene transition,
    // otherwise early capability replies are lost or arrive after the editor timeout.
    const inputSub = blk.term.onData(data => {
      if (!this._disposed && ab.status === 'executing') this.sinks.onTerminalData?.(data);
    });
    const tracker = trackBufferTruncation(blk.term, lines => { ab.linesTruncated += lines; });
    ab._truncationTracker = tracker;
    ab._outputDispose = () => { inputSub.dispose(); tracker.dispose(); blk.dispose(); };
    if (isTerminalDebugEnabled()) {
      terminalDebug('block-terminal-ready', { tabId: this.tabId, blockId: ab.id, cols: blk.term.cols, rows: blk.term.rows });
    }

    // earlyBuf 处置（typeahead / 提示符行剥离启发式，Spec §2）
    const early = ab.earlyBuf;
    ab.earlyBuf = '';
    if (early) {
      let rest = early;
      const lines = early.split('\n');
      const lastNonEmpty = [...lines].reverse().find((line) => line.trim().length > 0);
      if (lastNonEmpty !== undefined) {
        const lineIndex = lines.lastIndexOf(lastNonEmpty);
        const commandEcho = isCommandEcho(lastNonEmpty, ab.command);
        if (ab._fromA || commandEcho) {
          lines.splice(lineIndex, 1);
          rest = lines.join('\n');
        }
        if (commandEcho) {
          ab._pendingCommandEcho = null;
          ab._commandEchoPrefixConsumed = false;
        }
      }
      // 剩余含非空白内容 → 后台输出，进 outputTerm
      if (rest.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').trim().length > 0) {
        ab.outputTerm!.write(rest);
        ab.outputRaw = rest.slice(-RAW_CAP);
      }
    }

    this.longRunningTimer = setTimeout(() => {
      if (this._disposed) return;
      if (this.activeBlock === ab && ab.status === 'executing') {
        ab.wasLongRunning = true;
        // 活终端后已无周期同步，wasLongRunning 翻转（输入栏隐藏）需主动推 UI
        this.sinks.onBlocksChanged();
      }
    }, 2000);
    this.sinks.onBlockStart(ab);
    this.sinks.onBlocksChanged();
  }

  setPendingCommand(command: string): boolean {
    const normalized = command.trim();
    if (!normalized) return false;
    const active = this.activeBlock;
    if (active?.status === 'executing') {
      if (isTerminalDebugEnabled()) {
        terminalDebug('command-submit-to-running-process', {
          tabId: this.tabId,
          blockId: active.id,
          chars: normalized.length,
        });
      }
      return false;
    }
    this.pendingUiCommand = normalized;
    if (isTerminalDebugEnabled()) {
      terminalDebug('command-pending-ui', {
        tabId: this.tabId,
        chars: normalized.length,
        activeStatus: active?.status ?? null,
      });
    }
    // UI submission already identifies the command boundary. Remote shells may
    // emit prompt/completion markers without a preexec hook; their output must
    // not remain in the invisible pending buffer while waiting for OSC 133;C.
    if (this.blockEnabled && this._scene === 'blockList') {
      if (this.activeBlock?.status !== 'pending') {
        this.onPrecmd(false);
        this.pendingUiCommand = normalized;
      }
      this.onPreexec();
    }
    return true;
  }

  private onShellCommand(command: string): void {
    if (!command) return;
    const active = this.activeBlock;
    if (active?.status === 'executing') {
      if (!active._commandFromUi) {
        active.command = command;
        active._pendingCommandEcho = command.split(/\r?\n/, 1)[0]?.trim() || null;
        active._commandEchoPrefixConsumed = false;
        this.sinks.onBlocksChanged();
      }
      if (isTerminalDebugEnabled()) {
        terminalDebug('shell-command-late', {
          tabId: this.tabId,
          blockId: active.id,
          commandChars: command.length,
          uiCommandAuthoritative: active._commandFromUi,
        });
      }
      return;
    }
    this.pendingShellCommand = command;
    if (isTerminalDebugEnabled()) {
      terminalDebug('shell-command-pending', {
        tabId: this.tabId,
        commandChars: command.length,
        activeStatus: active?.status ?? null,
      });
    }
  }

  private stripCommandEcho(block: InternalBlock, text: string): string {
    if (block._consumeCommandEchoTerminator) {
      block._consumeCommandEchoTerminator = false;
      block._commandEchoPrefixConsumed = false;
      text = stripCommandEchoTerminator(text);
    }

    const command = block._pendingCommandEcho;
    if (!command) return text;
    const lineEnd = text.search(/[\r\n]/);
    if (lineEnd < 0) {
      const controlsLength = leadingCsiControlsLength(text);
      const visible = text.slice(controlsLength).trim();
      if (visible && command.startsWith(visible)) {
        const remaining = command.slice(visible.length);
        block._commandEchoPrefixConsumed = true;
        block._pendingCommandEcho = remaining || null;
        if (!remaining) {
          block._commandEchoPrefixConsumed = false;
          block._consumeCommandEchoTerminator = true;
        }
        if (isTerminalDebugEnabled()) {
          terminalDebug('command-echo-check', {
            chars: text.length,
            commandChars: command.length,
            matched: true,
            prefixChars: visible.length,
            complete: !remaining,
          });
        }
        return text.slice(0, controlsLength);
      }
      const possiblePrefix = stripTerminalControls(text).trim();
      if (!possiblePrefix || command.startsWith(possiblePrefix)) return text;
      block._pendingCommandEcho = null;
      block._commandEchoPrefixConsumed = false;
      if (isTerminalDebugEnabled()) {
        terminalDebug('command-echo-check', { chars: text.length, commandChars: command.length, hasLineEnd: false, matched: false });
      }
      return text;
    }

    block._pendingCommandEcho = null;
    const matched = block._commandEchoPrefixConsumed
      ? stripTerminalControls(text.slice(0, lineEnd)).trim() === command
      : isCommandEcho(text.slice(0, lineEnd), command);
    block._commandEchoPrefixConsumed = false;
    if (isTerminalDebugEnabled()) {
      terminalDebug('command-echo-check', { chars: text.length, commandChars: command.length, hasLineEnd: lineEnd >= 0, matched });
    }
    if (!matched) return text;
    let consumed = lineEnd + 1;
    if (text[lineEnd] === '\r') {
      if (text[lineEnd + 1] === '\n') consumed++;
      else if (lineEnd === text.length - 1) block._consumeCommandEchoTerminator = true;
    }
    return text.slice(consumed);
  }

  private onCommandDone(payload: string): void {
    const ab = this.activeBlock;
    if (!ab || ab.status !== 'executing') return;
    const ec = parseInt(payload, 10);
    if (isTerminalDebugEnabled()) {
      terminalDebug('command-done', { tabId: this.tabId, blockId: ab.id, exitCode: isNaN(ec) ? null : ec });
    }
    this.finishBlock(ab, isNaN(ec) ? null : ec, 'done');
  }

  private finishBlock(block: InternalBlock, exitCode: number | null, status: BlockStatus): void {
    this.setProgramTitle('');
    if (this.longRunningTimer) {
      clearTimeout(this.longRunningTimer);
      this.longRunningTimer = null;
    }
    // Publish completion metadata while retaining the live output until its snapshot is ready.
    block.exitCode = exitCode;
    block.status = status;
    block.snapshotPending = Boolean(block.outputTerm);
    block.endedAt = Date.now();
    const done = () => {
      if (this._disposed) return;
      if (block.outputTerm) {
        const term = block.outputTerm;
        const xtermCellWidth = term.element ? getCellMetrics(term).width : 0;
        const domCellWidth = measureTerminalDomCellWidth();
        const fontSize = getTerminalFontSize();
        const letterSpacingEm = domCellWidth > 0 && fontSize > 0
          ? ((xtermCellWidth || Math.round(domCellWidth)) - domCellWidth) / fontSize
          : 0;
        const snap = extractSnapshotFromBuffer(
          term.buffer.active,
          term.cols,
          undefined,
          undefined,
          letterSpacingEm,
          true,
        );
        if (isTerminalDebugEnabled() && Math.abs(letterSpacingEm) >= 0.001) {
          terminalDebug('block-snapshot-cell-width', {
            tabId: this.tabId,
            blockId: block.id,
            cols: term.cols,
            xtermCellWidth: Math.round(xtermCellWidth * 1000) / 1000,
            snapshotCellWidth: Math.round(domCellWidth * 1000) / 1000,
            letterSpacingEm: Math.round(letterSpacingEm * 100000) / 100000,
          });
        }
        block.outputHtml = snap.html;
        block.outputText = snap.plainText;
        block._outputDispose?.();
        block.outputTerm = null;
        block.outputEl = null;
        block._outputDispose = null;
        block._truncationTracker = null;
      }
      block.snapshotPending = false;
      this.enforceBlockCap();
      this.sinks.onBlockComplete(block);
      this.sinks.onBlocksChanged();
    };
    // xterm 的 write 是异步队列！D 与输出常在同一 chunk，此刻 outputTerm 尚未解析完。
    // 空写 + 回调利用 FIFO 保证此前所有写入已落 buffer，再提取快照（完成归零的关键）。
    if (block.outputTerm) {
      block.outputTerm.write('', done);
    } else {
      done();
    }
    this.sinks.onBlocksChanged();
  }

  private enforceBlockCap(): void {
    // 1. 只保留最近 MAX_FULL_BLOCKS 个完整块（有输出的）的输出，更早的只留 header
    const full = this._blocks.filter((b) => b.outputHtml || b.outputText);
    if (full.length > MAX_FULL_BLOCKS) {
      const excess = full.slice(0, full.length - MAX_FULL_BLOCKS);
      for (const b of excess) {
        b.outputHtml = '';
        b.outputText = '';
        b.outputRaw = '';
      }
    }
    // 2. 总块数硬上限：_blocks 数组本身要有界，否则 header 只增不减，
    //    store 每次全量 map/filter 越来越慢，长会话慢性内存增长。
    while (this._blocks.length > MAX_TOTAL_BLOCKS) {
      const [b] = this._blocks.splice(0, 1);
      if (!b) break;
      b._outputDispose?.();
      b.outputTerm = null;
      b.outputEl = null;
      b._outputDispose = null;
    }
  }

  // ── 场景切换 ──

  private enterAlt(raw: string): void {
    if (this._scene === 'altScreen') {
      this.sinks.writeMain(raw);
      return;
    }
    // alt 期间输出只写主 xterm，块内 outputTerm 收不到任何字节
    this.preAltScene = this._scene;
    if (isTerminalDebugEnabled()) terminalDebug('alternate-screen-enter', { tabId: this.tabId, previousScene: this._scene });
    this._scene = 'altScreen';
    this.sinks.writeMain(raw); // xterm 自己切 alt buffer
    this.sinks.onSceneChanged('altScreen');
  }

  private exitAlt(raw: string): void {
    if (this._scene !== 'altScreen') return;
    if (isTerminalDebugEnabled()) terminalDebug('alternate-screen-exit', { tabId: this.tabId, restoreScene: this.preAltScene });
    this.sinks.writeMain(raw);
    this._scene = this.preAltScene;
    // Leaving the alternate screen ends the full-screen program that owned the title.
    this.setProgramTitle('');
    this.sinks.onSceneChanged(this._scene);
  }

  // ── 外部接口 ──

  resize(cols: number, rows?: number): void {
    if (this.cols === cols && (rows === undefined || this.rows === rows)) return;
    this.cols = cols;
    if (rows !== undefined) this.rows = rows;
    const ab = this.activeBlock;
    if (ab?.status === 'executing' && ab.outputTerm) {
      ab._truncationTracker?.pause();
      resizeTerminal(ab.outputTerm, cols, this.rows);
      ab._truncationTracker?.resume();
    }
  }

  /**
   * 播种历史 block（会话恢复时）：把已持久化的 done block 塞进 controller 作为
   * 起始真相源，后续 shell 输出的新 block 追加在其后，避免 onBlocksChanged 把
   * 恢复出来的块整体覆盖掉。
   */
  seed(blocks: readonly TermBlock[]): void {
    if (isTerminalDebugEnabled()) {
      terminalDebug('blocks-restored', {
        tabId: this.tabId,
        count: blocks.length,
        recoveredExecuting: blocks.filter((block) => block.status === 'executing').length,
      });
    }
    const seeded: InternalBlock[] = blocks.map((b) => {
      const wasExecuting = b.status === 'executing';
      return {
        ...b,
        status: wasExecuting ? 'interrupted' : b.status,
        endedAt: wasExecuting ? Date.now() : b.endedAt,
        outputTerm: null,
        outputEl: null,
        _outputDispose: null,
        earlyBuf: '',
        _pendingCommandEcho: null,
        _commandEchoPrefixConsumed: false,
        _consumeCommandEchoTerminator: false,
        _truncationTracker: null,
        _commandFromUi: false,
        _fromA: false,
      };
    });
    this._blocks = seeded;
    this.sinks.onBlocksChanged();
  }

  /** Preserve each empty submission as a normal block with its directory context. */
  appendBlankLines(count: number): void {
    if (this._scene !== 'blockList' || this.activeBlock?.status === 'executing' || count < 1) return;
    if (this.activeBlock?.status !== 'pending') this.onPrecmd(false);
    const pending = this.activeBlock!;
    const now = Date.now();
    for (let index = 0; index < count; index++) {
      const blank: InternalBlock = {
        ...pending, id: `b${BLOCK_PREFIX}-${nextId++}`, command: '', status: 'done', exitCode: 0,
        startedAt: now, endedAt: now, outputHtml: '', outputRaw: '', outputText: '',
        earlyBuf: '', _fromA: false,
      };
      this._blocks.splice(this._blocks.length - 1, 0, blank);
      this.sinks.onBlockComplete(blank);
    }
    this.enforceBlockCap();
    this.sinks.onBlocksChanged();
  }

  /** 清空全部 block（用户「清除输出块」）。controller 是真相源，必须在此清，
   *  否则下一次 onBlocksChanged 会把 store 里清掉的 block 整体回填。 */
  clear(): void {
    for (const b of this._blocks) {
      b._outputDispose?.();
      b.outputTerm = null;
      b.outputEl = null;
      b._outputDispose = null;
    }
    this._blocks = [];
    this.sinks.onBlocksChanged();
  }

  dispose(): void {
    this._disposed = true;
    // The pane keeps its last counter window even though the pipeline stops here.
    this.ioLog.flush();
    this.ioLog.dispose();
    if (this.longRunningTimer) {
      clearTimeout(this.longRunningTimer);
      this.longRunningTimer = null;
    }
    for (const b of this._blocks) {
      b._outputDispose?.();
      b.outputTerm = null;
      b.outputEl = null;
      b._outputDispose = null;
    }
    this._blocks = [];
  }
}

/** Clean a program-set window title: drop control characters, collapse whitespace, cap length. */
function cleanProgramTitle(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
}

function decodeB64(b64: string): string {
  try {
    return decodeURIComponent(escape(atob(b64)));
  } catch {
    return b64;
  }
}

function stripTerminalControls(value: string): string {
  return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}

function leadingCsiControlsLength(value: string): number {
  let rest = value;
  let length = 0;
  while (rest.startsWith('\x1b[')) {
    const match = /^\x1b\[[0-?]*[ -/]*[@-~]/.exec(rest);
    if (!match) break;
    length += match[0].length;
    rest = rest.slice(match[0].length);
  }
  return length;
}

function stripCommandEchoTerminator(value: string): string {
  const controlsLength = leadingCsiControlsLength(value);
  const rest = value.slice(controlsLength);
  if (rest.startsWith('\r\n')) return value.slice(0, controlsLength) + rest.slice(2);
  if (rest.startsWith('\r') || rest.startsWith('\n')) {
    return value.slice(0, controlsLength) + rest.slice(1);
  }
  return value;
}

function isCommandEcho(line: string, command: string): boolean {
  const firstLine = command.split(/\r?\n/, 1)[0]?.trim() ?? '';
  if (!firstLine) return false;
  const visible = stripTerminalControls(line).replace(/\r/g, '').trim();
  if (visible === firstLine) return true;
  if (!visible.endsWith(firstLine)) return false;
  // Only a shell prompt may precede an echoed command; ordinary output can end with it too.
  const prefix = visible.slice(0, -firstLine.length).trimEnd();
  return /[$#>%❯]$/.test(prefix);
}
