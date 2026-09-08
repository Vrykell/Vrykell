/**
 * SessionController — block 生命周期 + 三场景状态机（Spec §1-§3）。
 *
 * 同步消费 Rust 端扫描后的 DispatchEvent（扫描见 src-tauri/src/scan.rs）；每段输出只有一个目的地：
 *   blockList·pending    → activeBlock.earlyBuf
 *   blockList·executing  → activeBlock.outputTerm（块内活 xterm，RunningItem 挂载显示）
 *   classic / altScreen  → 主 xterm（OSC raw 也转发，保 OSC 8/52）
 */

import type { Terminal } from '@xterm/xterm';
import type { DispatchEvent } from '@/features/terminal/pipeline/events';
import type { BlockStatus, TermBlock } from '@/features/terminal/pipeline/termBlock';
import { createBlockTerm, extractSnapshotFromBuffer } from '@/features/terminal/terminalSnapshot';

export type Scene = 'classic' | 'blockList' | 'altScreen';

export interface SessionSinks {
  writeMain(data: string): void;
  onBlocksChanged(): void;
  onSceneChanged(scene: Scene): void;
  onCwd(path: string): void;
  onBlockStart(block: TermBlock): void;
  onBlockComplete(block: TermBlock): void;
  /** 读取当前书签块 id 集合（书签状态只活在 store，controller 驱逐块时需反查） */
  getBookmarkedIds?(): Set<string>;
}

const RAW_CAP = 256 * 1024;
const MAX_FULL_BLOCKS = 200; // 超出丢弃最老 block 的输出，保留 header
const MAX_TOTAL_BLOCKS = 500; // 总块数硬上限（含 header-only），超出丢弃最老非书签块

interface InternalBlock extends TermBlock {
  outputTerm: Terminal | null;
  /** outputTerm 的隐藏宿主 div（RunningItem 挂载时移进卡片可见化） */
  outputEl: HTMLDivElement | null;
  _outputDispose: (() => void) | null;
  earlyBuf: string;
  _prevBaseY: number;
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
  private pendingCommand = '';
  private longRunningTimer: ReturnType<typeof setTimeout> | null = null;
  private _disposed = false;
  /** 最近一次 OSC 7 上报的 cwd：真实 RC 顺序是 OSC7 → D → A，新 block 以此播种 */
  private lastCwd: string | undefined;

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
    // tabId 保留给未来调试/持久化使用
    void this.tabId;
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
      ab.outputTerm?.write(text);
      // 追加后仅在超出 2×上限时裁剪一次，避免每个 data 事件都对 256KB 字符串
      // 做 concat + slice 两次全量拷贝（长输出时是明显卡顿源）
      ab.outputRaw += text;
      if (ab.outputRaw.length > RAW_CAP * 2) {
        ab.outputRaw = ab.outputRaw.slice(-RAW_CAP);
      }
      this.trackTruncation(ab);
    } else {
      ab.earlyBuf += text;
    }
  }

  // ── OSC 处理 ──

  private handleOsc(code: string, payload: string, raw: string): void {
    // classic/altScreen：OSC raw 转发主 xterm（OSC 8 超链接等不失效）；
    // 但 133/7 是 integration 标记，永不进主 xterm。
    const isIntegration =
      code === '133;A' ||
      code === '133;C' ||
      code === '133;D' ||
      code === '133;E' ||
      code === '133;G' ||
      code === '7';
    if (this._scene !== 'blockList' && !isIntegration) {
      this.sinks.writeMain(raw);
      return;
    }

    switch (code) {
      case '133;A':
        this.onPrecmd(true);
        break;
      case '133;E':
        this.pendingCommand = decodeB64(payload).trim();
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
        const idx = payload.indexOf('/', 7);
        if (idx > 0) {
          const path = payload.slice(idx);
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
        // 其他 OSC（0/2 标题等）：blockList 下丢弃
        break;
    }
  }

  // ── Block 生命周期（Spec §2） ──

  private onPrecmd(fromA = true): void {
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
      _prevBaseY: 0,
      _fromA: fromA,
    };
    this._blocks.push(block);
    this.enforceBlockCap();
    this.sinks.onBlocksChanged();
  }

  private onPreexec(): void {
    const ab = this.activeBlock;
    if (!ab || ab.status !== 'pending') return;
    ab.command = this.pendingCommand;
    ab.startedAt = Date.now();
    ab.status = 'executing';

    // 创建块内活终端（隐藏宿主，RunningItem 挂载后移入卡片可见化）
    const blk = createBlockTerm(this.cols, this.rows);
    ab.outputTerm = blk.term;
    ab.outputEl = blk.el;
    ab._outputDispose = blk.dispose;

    // earlyBuf 处置（typeahead / 提示符行剥离启发式，Spec §2）
    const early = ab.earlyBuf;
    ab.earlyBuf = '';
    if (early) {
      let rest = early;
      if (ab._fromA) {
        const lines = early.split('\n');
        // 正常 A 创建的 block：earlyBuf 最后一非空行是提示符+命令行，剥离它
        const lastNonEmpty = [...lines].reverse().find((l) => l.trim().length > 0);
        if (lastNonEmpty !== undefined) {
          lines.splice(lines.lastIndexOf(lastNonEmpty), 1);
        }
        rest = lines.join('\n');
      }
      // 剩余含非空白内容 → 后台输出，进 outputTerm
      if (rest.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').trim().length > 0) {
        ab.outputTerm!.write(rest);
        ab.outputRaw = rest.slice(-RAW_CAP);
        this.trackTruncation(ab);
      }
    }

    this.pendingCommand = '';
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

  private onCommandDone(payload: string): void {
    const ab = this.activeBlock;
    if (!ab || ab.status !== 'executing') return;
    const ec = parseInt(payload, 10);
    this.finishBlock(ab, isNaN(ec) ? null : ec, 'done');
  }

  private finishBlock(block: InternalBlock, exitCode: number | null, status: BlockStatus): void {
    if (this.longRunningTimer) {
      clearTimeout(this.longRunningTimer);
      this.longRunningTimer = null;
    }
    // 状态先同步更新并推一次 UI：done/interrupted 样式立即生效
    block.exitCode = exitCode;
    block.status = status;
    block.endedAt = Date.now();
    const done = () => {
      if (this._disposed) return;
      this.trackTruncation(block);
      if (block.outputTerm) {
        const snap = extractSnapshotFromBuffer(
          block.outputTerm.buffer.active,
          block.outputTerm.cols,
        );
        block.outputHtml = snap.html;
        block.outputText = snap.plainText;
        block._outputDispose?.();
        block.outputTerm = null;
        block.outputEl = null;
        block._outputDispose = null;
      }
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

  // ── 截断统计 ──

  private trackTruncation(block: InternalBlock): void {
    if (!block.outputTerm) return;
    const baseY = block.outputTerm.buffer.active.baseY;
    const delta = baseY - block._prevBaseY;
    if (delta > 0) block.linesTruncated += delta;
    block._prevBaseY = baseY;
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
    const bookmarkedIds = this.sinks.getBookmarkedIds?.() ?? new Set<string>();
    while (this._blocks.length > MAX_TOTAL_BLOCKS) {
      const idx = this._blocks.findIndex((b) => !bookmarkedIds.has(b.id));
      if (idx === -1) break; // 全是书签，兜底放弃上限（避免死循环）
      const [b] = this._blocks.splice(idx, 1);
      b!._outputDispose?.();
      b!.outputTerm = null;
      b!.outputEl = null;
      b!._outputDispose = null;
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
    this._scene = 'altScreen';
    this.sinks.writeMain(raw); // xterm 自己切 alt buffer
    this.sinks.onSceneChanged('altScreen');
  }

  private exitAlt(raw: string): void {
    if (this._scene !== 'altScreen') return;
    this.sinks.writeMain(raw);
    this._scene = this.preAltScene;
    this.sinks.onSceneChanged(this._scene);
  }

  // ── 外部接口 ──

  resize(cols: number, rows?: number): void {
    this.cols = cols;
    if (rows !== undefined) this.rows = rows;
    const ab = this.activeBlock;
    if (ab?.status === 'executing' && ab.outputTerm) {
      ab.outputTerm.resize(cols, this.rows);
    }
  }

  /**
   * 播种历史 block（会话恢复时）：把已持久化的 done block 塞进 controller 作为
   * 起始真相源，后续 shell 输出的新 block 追加在其后，避免 onBlocksChanged 把
   * 恢复出来的块整体覆盖掉。
   */
  seed(blocks: readonly TermBlock[]): void {
    const seeded: InternalBlock[] = blocks.map((b) => ({
      ...b,
      outputTerm: null,
      outputEl: null,
      _outputDispose: null,
      earlyBuf: '',
      _prevBaseY: 0,
      _fromA: false,
    }));
    this._blocks = seeded;
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

function decodeB64(b64: string): string {
  try {
    return decodeURIComponent(escape(atob(b64)));
  } catch {
    return b64;
  }
}
