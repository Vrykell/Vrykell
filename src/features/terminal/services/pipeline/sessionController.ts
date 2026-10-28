import { resizeTerminal } from '../../model/terminalResize';
/**
 * SessionController — block lifecycle and three-scene state machine (spec §1-§3).
 *
 * Synchronously consumes DispatchEvent batches from the backend scanner; every output
 * segment has exactly one destination:
 *   blockList·pending    → activeBlock.earlyBuf
 *   blockList·executing  → activeBlock.outputTerm (in-block live terminal, mounted by RunningItem)
 *   classic / altScreen  → main terminal (raw OSC forwarded too, preserving OSC 8/52)
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
import { registerBlockTerminal, unregisterBlockTerminal } from '@features/terminal/services/terminalRepaint';
import { decodePowerShellSubmission } from '../../model/commandSubmission';
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
  takePendingUiCommand?(): { command: string; wireCommand?: string } | null;
  clearPendingUiCommand?(): void;
}

const RAW_CAP = 256 * 1024;
const MAX_FULL_BLOCKS = 200;    // Beyond this, drop the oldest blocks' output but keep their headers
const MAX_TOTAL_BLOCKS = 500;   // Hard cap for block history, including header-only entries.

interface InternalBlock extends TermBlock {
  outputTerm: Terminal | null;
  /** Hidden host div for outputTerm (RunningItem moves it into the card when mounting) */
  outputEl: HTMLDivElement | null;
  _outputDispose: (() => void) | null;
  earlyBuf: string;
  _pendingCommandEcho: string | null;
  _commandEchoPrefixConsumed: boolean;
  _consumeCommandEchoTerminator: boolean;
  _truncationTracker: BufferTruncationTracker | null;
  _commandFromUi: boolean;
  /** Whether OSC 133;A created the block normally (decides whether earlyBuf includes the prompt line) */
  _fromA: boolean;
}

// Block ids stay unique across restarts (timestamp prefix plus counter) so restored history cannot collide
const BLOCK_PREFIX = Date.now().toString(36);
let nextId = 1;

export class SessionController {
  private _blocks: InternalBlock[] = [];
  private _scene: Scene;
  /** Scene before entering altScreen (restored on exit) */
  private preAltScene: Scene;
  /** Whether the block system is enabled: false = classic mode (traditional terminal, output goes straight to the main terminal, no blocks) */
  private blockEnabled: boolean;
  private pendingUiCommand = '';
  private pendingWireCommand = '';
  private pendingShellCommand = '';
  private pendingShellEcho = '';
  private pendingPreexecTimer: ReturnType<typeof setTimeout> | null = null;
  private longRunningTimer: ReturnType<typeof setTimeout> | null = null;
  private _disposed = false;
  /** Last cwd reported by OSC 7: the real RC order is OSC7 → D → A, and new blocks are seeded with it */
  private lastCwd: string | undefined;
  /** Window title set by the current foreground program (OSC 0/2); empty = unset, valid only while a program owns the terminal */
  private programTitle = '';
  /** Pipeline counters of this pane; the session hook feeds the receive stage into the same window. */
  readonly ioLog: TerminalIoLog;

  constructor(
    private tabId: string,
    private cols: number,
    private sinks: SessionSinks,
    /** Rows of the in-block live terminal (= main terminal/PTY rows, which keeps TUI geometry identical); defaults to 24 */
    private rows = 24,
    /** Initial scene (terminal open mode: classic or blockList); defaults to classic */
    initialScene: Scene = 'classic',
    /** Block system switch; false = classic mode (traditional terminal) */
    blockEnabled = true,
    /** Integrated shells create the block when OSC 133;E reports the command. */
    private deferBlockUntilPreexec = false,
    /** Show output even if a broken integration never emits OSC 133;C. */
    private deferFallbackMs = 3000,
  ) {
    this.ioLog = new TerminalIoLog(tabId);
    this._scene = initialScene;
    this.preAltScene = initialScene;
    this.blockEnabled = blockEnabled;
  }

  private clearPendingPreexecTimer(): void {
    if (this.pendingPreexecTimer) {
      clearTimeout(this.pendingPreexecTimer);
      this.pendingPreexecTimer = null;
    }
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

  /** Live terminal of the running block (term + hidden host el); null when no block is executing */
  get executingTerm(): { term: Terminal; el: HTMLDivElement } | null {
    const ab = this.activeBlock;
    if (ab?.status === 'executing' && ab.outputTerm && ab.outputEl) {
      return { term: ab.outputTerm, el: ab.outputEl };
    }
    return null;
  }

  // ── Event entry ──

  handleEvents(events: DispatchEvent[]): void {
    this.ioLog.consumed(events, this._scene);
    if (!this.blockEnabled) {
      // Classic mode: traditional terminal, all output goes straight to the main terminal (no blocks, no scene switches, TUIs handled natively)
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

  // ── Data routing (single destination) ──

  private routeData(text: string): void {
    if (this._scene === 'classic' || this._scene === 'altScreen') {
      this.ioLog.routed('main', text.length);
      this.sinks.writeMain(text);
      return;
    }
    let ab = this.activeBlock;
    if (!ab || (ab.status !== 'executing' && ab.status !== 'pending')) {
      // No active block in blockList (for example the previous one is done): create a pending block for the orphan output
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

  // ── OSC handling ──

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
    // classic/altScreen: forward raw OSC to the main terminal (keeps OSC 8 hyperlinks working),
    // but 133/7 are integration markers and never reach the main terminal.
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
          // OSC 7 often arrives before 133;A (the real RC order); the active block is then
          // the one that just finished, so the new cwd must not be attached to it. Only a
          // pending block (the current prompt line) is updated in place.
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

  // ── Block lifecycle (spec §2) ──

  private onPrecmd(fromA = true): void {
    const wasClassic = this._scene === 'classic';
    if (isTerminalDebugEnabled()) {
      terminalDebug('block-prompt-start', { tabId: this.tabId, scene: this._scene, previousStatus: this.activeBlock?.status ?? null });
    }
    // The prompt is back: any title the previous foreground program set no longer applies.
    this.setProgramTitle('');
    // First A: classic → blockList
    if (this._scene === 'classic') {
      this._scene = 'blockList';
      this.sinks.onSceneChanged('blockList');
    }
    const prev = this.activeBlock;
    if (prev && (prev.status === 'executing' || prev.status === 'pending')) {
      // A without a preceding D (Ctrl+C interrupt / empty submission)
      if (prev.status === 'executing') {
        this.finishBlock(prev, null, 'interrupted');
      } else {
        // Empty pending block (repeated Enter): mark done with no output
        prev.status = 'done';
        prev.endedAt = Date.now();
      }
    }
    // An integrated shell can report the prompt after the command was submitted but before
    // OSC 133;E. Keep the visible command until the preexec marker consumes it, but not when
    // the pane was still in classic mode (authentication or a missing integration).
    if (!(this.deferBlockUntilPreexec && !wasClassic && this.pendingUiCommand)) {
      this.clearPendingPreexecTimer();
      this.pendingUiCommand = '';
      this.pendingWireCommand = '';
      this.sinks.clearPendingUiCommand?.();
    }
    this.pendingShellCommand = '';
    this.pendingShellEcho = '';
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
    this.clearPendingPreexecTimer();
    const ab = this.activeBlock;
    if (!ab || ab.status !== 'pending') return;
    const controllerUiCommand = this.pendingUiCommand;
    const deferred = this.sinks.takePendingUiCommand?.() ?? null;
    const deferredUiCommand = deferred?.command ?? '';
    const uiCommand = controllerUiCommand || deferredUiCommand;
    const shellCommand = this.pendingShellCommand;
    const command = uiCommand || shellCommand;
    const wireCommand = this.pendingWireCommand || deferred?.wireCommand || this.pendingShellEcho || command;
    this.pendingUiCommand = '';
    this.pendingWireCommand = '';
    this.pendingShellCommand = '';
    this.pendingShellEcho = '';
    if (isTerminalDebugEnabled()) {
      terminalDebug('command-start', {
        tabId: this.tabId,
        blockId: ab.id,
        commandChars: command.length,
        wireChars: wireCommand.length,
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
    ab._pendingCommandEcho = wireCommand.split(/\r?\n/, 1)[0]?.trim() || null;
    ab._commandEchoPrefixConsumed = false;

    // Create the in-block live terminal (hidden host; RunningItem moves it into the card when mounting)
    const blk = createBlockTerm(this.cols, this.rows);
    ab.outputTerm = blk.term;
    ab.outputEl = blk.el;
    // Track the live block terminal for app-wide drawing operations (shared glyph atlas resets).
    registerBlockTerminal(this.tabId, blk.term);
    // Subscribe before the first write. UI mounting can follow a scene transition,
    // otherwise early capability replies are lost or arrive after the editor timeout.
    const inputSub = blk.term.onData(data => {
      if (!this._disposed && ab.status === 'executing') this.sinks.onTerminalData?.(data);
    });
    const tracker = trackBufferTruncation(blk.term, lines => { ab.linesTruncated += lines; });
    ab._truncationTracker = tracker;
    ab._outputDispose = () => {
      inputSub.dispose();
      tracker.dispose();
      unregisterBlockTerminal(this.tabId, blk.term);
      blk.dispose();
    };
    if (isTerminalDebugEnabled()) {
      terminalDebug('block-terminal-ready', { tabId: this.tabId, blockId: ab.id, cols: blk.term.cols, rows: blk.term.rows });
    }

    // Handle earlyBuf (typeahead / prompt-line stripping heuristic, spec §2)
    const early = ab.earlyBuf;
    ab.earlyBuf = '';
    if (early) {
      let rest = early;
      const lines = early.split('\n');
      // The echo can precede output when a broken integration falls back to the eager boundary.
      const echoIndex = lines.findIndex((line) => isCommandEcho(line, wireCommand) || isCommandEcho(line, ab.command));
      if (echoIndex >= 0) {
        lines.splice(echoIndex, 1);
        rest = lines.join('\n');
        ab._pendingCommandEcho = null;
        ab._commandEchoPrefixConsumed = false;
      } else if (ab._fromA) {
        const lastNonEmpty = [...lines].reverse().find((line) => line.trim().length > 0);
        if (lastNonEmpty !== undefined) {
          const visible = stripTerminalControls(lastNonEmpty).trim();
          // Discard a prompt-shaped line, never a line that could be command output.
          if (!visible || /[$#>%❯]$/.test(visible)) {
            lines.splice(lines.lastIndexOf(lastNonEmpty), 1);
            rest = lines.join('\n');
          }
        }
      }
      // Remaining non-whitespace content is background output, written to outputTerm
      if (rest.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').trim().length > 0) {
        ab.outputTerm!.write(rest);
        ab.outputRaw = rest.slice(-RAW_CAP);
      }
    }

    this.longRunningTimer = setTimeout(() => {
      if (this._disposed) return;
      if (this.activeBlock === ab && ab.status === 'executing') {
        ab.wasLongRunning = true;
        // The live terminal has no periodic sync afterwards, so a wasLongRunning flip (which hides the composer) must be pushed to the UI
        this.sinks.onBlocksChanged();
      }
    }, 2000);
    this.sinks.onBlockStart(ab);
    this.sinks.onBlocksChanged();
  }

  setPendingCommand(command: string, wireCommand?: string): boolean {
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
    if (this.deferBlockUntilPreexec && this.pendingUiCommand) {
      return normalized === this.pendingUiCommand && (wireCommand ?? normalized) === this.pendingWireCommand;
    }
    this.pendingUiCommand = normalized;
    this.pendingWireCommand = wireCommand ?? normalized;
    if (isTerminalDebugEnabled()) {
      terminalDebug('command-pending-ui', {
        tabId: this.tabId,
        chars: normalized.length,
        wireChars: this.pendingWireCommand.length,
        activeStatus: active?.status ?? null,
      });
    }
    // Integrated shells create the block at OSC 133;E with the visible command, so a late
    // prompt cannot close an eager block before the real command starts. A broken integration
    // must not hide the output, so fall back to the eager boundary after a grace period.
    if (this.deferBlockUntilPreexec) {
      this.clearPendingPreexecTimer();
      this.pendingPreexecTimer = setTimeout(() => {
        this.pendingPreexecTimer = null;
        if (this._disposed) return;
        if (this.deferBlockUntilPreexec && this.pendingUiCommand && this.activeBlock?.status === 'pending') {
          this.onPreexec();
        }
      }, this.deferFallbackMs);
      return true;
    }
    // UI submission already identifies the command boundary. Remote shells may
    // emit prompt/completion markers without a preexec hook; their output must
    // not remain in the invisible pending buffer while waiting for OSC 133;C.
    if (this.blockEnabled && this._scene === 'blockList') {
      if (this.activeBlock?.status !== 'pending') {
        this.onPrecmd(false);
        this.pendingUiCommand = normalized;
        this.pendingWireCommand = wireCommand ?? normalized;
      }
      this.onPreexec();
    }
    return true;
  }

  /** Drop a submission that never reached the shell, including its fallback boundary. */
  clearPendingCommand(): void {
    this.clearPendingPreexecTimer();
    this.pendingUiCommand = '';
    this.pendingWireCommand = '';
  }

  private onShellCommand(command: string): void {
    if (!command) return;
    const displayCommand = decodePowerShellSubmission(command) ?? command;
    const active = this.activeBlock;
    if (active?.status === 'executing') {
      if (!active._commandFromUi) {
        active.command = displayCommand;
        active._pendingCommandEcho = command.split(/\r?\n/, 1)[0]?.trim() || null;
        active._commandEchoPrefixConsumed = false;
        this.sinks.onBlocksChanged();
      }
      if (isTerminalDebugEnabled()) {
        terminalDebug('shell-command-late', {
          tabId: this.tabId,
          blockId: active.id,
          commandChars: displayCommand.length,
          wireChars: command.length,
          uiCommandAuthoritative: active._commandFromUi,
        });
      }
      return;
    }
    // A command can arrive before the prompt marker on a slow or fast shell. Create the
    // boundary now, but keep the visible command for the preexec that follows.
    if (this.deferBlockUntilPreexec && active?.status !== 'pending') {
      const staged = this.sinks.takePendingUiCommand?.() ?? null;
      const uiCommand = this.pendingUiCommand || staged?.command || '';
      const wireCommand = this.pendingWireCommand || staged?.wireCommand || '';
      this.pendingUiCommand = uiCommand;
      this.pendingWireCommand = wireCommand;
      this.onPrecmd(false);
      this.pendingUiCommand = uiCommand;
      this.pendingWireCommand = wireCommand;
    }
    this.pendingShellCommand = displayCommand;
    this.pendingShellEcho = command;
    if (isTerminalDebugEnabled()) {
      terminalDebug('shell-command-pending', {
        tabId: this.tabId,
        commandChars: displayCommand.length,
        wireChars: command.length,
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
    // Completion is an authoritative boundary even when the shell omits its preexec hook.
    if (this.activeBlock?.status === 'pending' && this.pendingUiCommand) this.onPreexec();
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
    // Terminal writes are an async queue: D and its output often share a chunk, so outputTerm
    // has not finished parsing yet. An empty write plus callback uses the FIFO to guarantee
    // earlier writes reached the buffer before the snapshot is taken.
    if (block.outputTerm) {
      block.outputTerm.write('', done);
    } else {
      done();
    }
    this.sinks.onBlocksChanged();
  }

  private enforceBlockCap(): void {
    // 1. Keep output only for the most recent MAX_FULL_BLOCKS blocks that have output; older ones keep their header
    const full = this._blocks.filter((b) => b.outputHtml || b.outputText);
    if (full.length > MAX_FULL_BLOCKS) {
      const excess = full.slice(0, full.length - MAX_FULL_BLOCKS);
      for (const b of excess) {
        b.outputHtml = '';
        b.outputText = '';
        b.outputRaw = '';
      }
    }
    // 2. Hard cap on total blocks: the _blocks array itself must stay bounded, otherwise
    //    headers only accumulate and every full map/filter in the store gets slower,
    //    growing memory over long sessions.
    while (this._blocks.length > MAX_TOTAL_BLOCKS) {
      const [b] = this._blocks.splice(0, 1);
      if (!b) break;
      b._outputDispose?.();
      b.outputTerm = null;
      b.outputEl = null;
      b._outputDispose = null;
    }
  }

  // ── Scene switching ──

  private enterAlt(raw: string): void {
    if (this._scene === 'altScreen') {
      this.sinks.writeMain(raw);
      return;
    }
    // While alt is active, output goes only to the main terminal; the block's outputTerm receives no bytes
    this.preAltScene = this._scene;
    if (isTerminalDebugEnabled()) terminalDebug('alternate-screen-enter', { tabId: this.tabId, previousScene: this._scene });
    this._scene = 'altScreen';
    this.sinks.writeMain(raw); // the terminal switches to the alt buffer itself
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

  // ── External interface ──

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
   * Seed persisted blocks when a session is restored: they become the controller's starting
   * source of truth so new shell output appends after them instead of onBlocksChanged
   * overwriting the restored blocks.
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

  /** A session ended before its command reported completion: close the active block. */
  interruptActive(): void {
    const ab = this.activeBlock;
    if (ab?.status !== 'executing') return;
    if (isTerminalDebugEnabled()) {
      terminalDebug('block-interrupted', { tabId: this.tabId, blockId: ab.id, reason: 'session-exit' });
    }
    this.finishBlock(ab, null, 'interrupted');
  }

  /** Remove all blocks (the user's "clear output blocks" action). The controller is the
   *  source of truth, so they must be cleared here, otherwise the next onBlocksChanged
   *  refills the blocks the store just cleared. */
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
    this.clearPendingPreexecTimer();
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
