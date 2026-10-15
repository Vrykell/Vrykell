import type { Page } from '@playwright/test';

export interface TauriMockOptions {
  launchDirectory?: string;
  contextMenu?: { available?: boolean; enabled?: boolean; stale?: boolean; certificateTrusted?: boolean };
  /** 是否启用 OSC 133 shell integration（默认 true）。
   *  false 时 mock 保持 classic 场景，用于测试无 integration 回退。 */
  integration?: boolean;
  sshHost?: 'known' | 'unknown' | 'changed';
  sshTrustConfirmed?: boolean;
  /** Scheduled-task seed; pass [] to keep the send slot for the spec (the default seed is due at boot). */
  schedulesSeed?: Record<string, unknown>[];
  /** Simulate a remote shell with prompt hooks but no preexec hook. */
  sshPreexec?: boolean;
  /** Add one historical session under an archived group to test restoring it by itself. */
  groupedHistoricalSession?: boolean;
  /** Keep the prompt but omit the OSC 133;B ready marker (older hooks / exotic shells). */
  shellReadyMarker?: boolean;
  /** 预置模型列表（默认 2 个：主力模型 + 本地模型） */
  aiModels?: { id: string; name: string; provider: string; baseUrl: string; model: string }[];
  /** 当前生效模型 id（默认 '' = 镜像字段） */
  aiActive?: string;
  /** 预置技能列表（默认 2 个：写单测 / 旧脚本技能） */
  skills?: Record<string, unknown>[];
}

/**
 * 注入 Tauri IPC 的浏览器端假实现：
 * - pty_* 命令：假 shell（回显写入内容到 pty-output 事件）
 * - fs_list：固定假目录
 * - plugin:event|listen/unlisten：事件注册表
 * 同时预置 API Key 跳过 ApiKeyField。
 *
 * 新终端管线由 OSC 133 shell integration 驱动场景切换，
 * 因此 mock 的 PTY 输出默认 emit 完整 OSC 133 序列。
 *
 * @tauri-apps/api v2 契约（见 node_modules/@tauri-apps/api/core.js）：
 * invoke → __TAURI_INTERNALS__.invoke(cmd, args)
 * listen → transformCallback 注册 window[`_${id}`]，再 invoke('plugin:event|listen', {event, handler: id})
 */
export async function setupTauriMock(page: Page, opts: TauriMockOptions = {}) {
  const integration = opts.integration !== false;
  const seedModels = opts.aiModels ?? [
    { id: 'm-main', name: '主力模型', provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5', capabilities: { vision: true, reasoning: true, tools: true, search: true } },
    { id: 'm-local', name: '本地模型', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5', capabilities: { vision: false, reasoning: false, tools: true, search: false } },
  ];
  const seedActive = opts.aiActive ?? 'm-local';
  // Scheduled tasks: the default seed has never run, so it is due the moment the app boots. A spec
  // that needs the single send slot for itself (asserting Stop, say) must pass [] — otherwise that
  // background turn takes sendingTab first and the user's own send is dropped.
  const seedSchedules = opts.schedulesSeed ?? [
    { id: 's1', name: '每日巡检', prompt: '检查系统状态并汇报', intervalMinutes: 60, enabled: true, lastRunAt: 0 },
  ];
  const seedSkills = opts.skills ?? [
    { name: '写单测', description: '为代码写单元测试', source: 'local', trusted: true, enabled: true, hasScripts: false, modified: false, files: ['SKILL.md'], dir: '/home/e2e/.vrykell/skills/写单测', prompt: '先看代码，再写 vitest 单测。' },
    { name: '旧脚本技能', description: '遗留技能，含脚本', source: 'market', trusted: false, enabled: false, hasScripts: true, modified: true, files: ['SKILL.md', 'scripts/run.sh', 'references/说明.md'], dir: '/home/e2e/.vrykell/skills/旧脚本技能', prompt: '运行 scripts/run.sh 完成工作。' },
  ];
  await page.addInitScript(
    ({ enableIntegration, enableReadyMarker, models, active, skillsSeed, scheduleSeed, sshHost, sshTrustConfirmed, sshPreexec, groupedHistoricalSession, launchDirectory, menuSeed }) => {
    const menu = { supported: true, available: true, enabled: false, stale: false, certificateTrusted: false, certificateThumbprint: 'E2E-CERTIFICATE', ...menuSeed };
    const menuActions: string[] = [];
    (window as unknown as { __MENU_ACTIONS__: string[] }).__MENU_ACTIONS__ = menuActions;
    let cbCounter = 0;
    const eventListeners = new Map<string, number>();
    let fullscreen = false;
    const writes: string[] = [];
    const sshTrusts: Record<string, unknown>[] = [];
    const dialogs: Record<string, unknown>[] = [];
    const diagnosticsExports: Record<string, unknown>[] = [];
    /** Frontend diagnostic records the app sent, exposed so specs can check what the log keeps. */
    const diagnosticRecords: Record<string, unknown>[] = [];
    const spawns: Record<string, unknown>[] = [];
    const closes: Record<string, unknown>[] = [];
    (window as unknown as Record<string, unknown>).__SSH_TRUSTS__ = sshTrusts;
    (window as unknown as Record<string, unknown>).__SSH_DIALOGS__ = dialogs;
    (window as unknown as Record<string, unknown>).__DIAGNOSTICS_EXPORTS__ = diagnosticsExports;
    (window as unknown as Record<string, unknown>).__DIAGNOSTIC_RECORDS__ = diagnosticRecords;
    (window as unknown as Record<string, unknown>).__PTY_SPAWNS__ = spawns;
    (window as unknown as Record<string, unknown>).__PTY_CLOSES__ = closes;
    let hostKnown = sshHost === 'known';
    let clipboardText = '';
    let clipboardFiles: { paths: string[]; mode: string } | null = null;
    const signals: { id: string; sig: number }[] = [];
    const killAttempts = new Map<string, number>();
    const resizes: { cols: number; rows: number }[] = [];
    const fsOps: { op: string; path: string; newName?: string }[] = [];
    /** 新建出来的条目（让后续列表能看到，便于断言「新建后立即重命名」）。 */
    const createdEntries: { name: string; path: string; is_dir: boolean }[] = [];
    const sshOps: { op: string; path: string; newName?: string; destDir?: string }[] = [];
    const downloads: Record<string, unknown>[] = [];
    const revealed: string[] = [];
    /** Paths handed to the system default application (plugin:opener|open_path). */
    const opened: string[] = [];
    const aiConfig: { hasKey: boolean; baseUrl: string; model: string } = {
      hasKey: true,
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    };
    // ── AI 多模型配置（设置页「模型配置」读写） ──
    const aiModels: { id: string; name: string; provider: string; baseUrl: string; model: string }[] = models;
    let aiActive = active;
    let aiProvider: string = 'openai-compatible';
    let aiHasAnthropic = false;
    let aiHasGemini = false;
    let aiHasTavily = false;
    const aiKeyCalls: { provider: string; key?: string }[] = [];
    const aiModelCalls: { kind: string; models?: unknown[]; active?: string; id?: string }[] = [];
    // ── 技能系统 ──
    const skills: Record<string, unknown>[] = skillsSeed;
    const skillOps: { op: string; name: string; trusted?: boolean | null; enabled?: boolean | null; prompt?: string }[] = [];
    // ── MCP ──
    const mcpServers: Record<string, unknown>[] = [
      { name: '文件系统', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'], url: '', env: {}, enabled: true, connected: true, toolCount: 3 },
    ];
    const mcpOps: { op: string; name: string; config?: unknown }[] = [];
    // ── 记忆 ──
    const memory = { fact: '用户偏好：优先用 Rust。\n项目约定：单测覆盖核心逻辑。', journal: '2025-06-01 修复了工具注册 bug\n2025-06-02 补了 e2e 测试' };
    const memoryOps: { op: string; content?: string; text?: string }[] = [];
    // ── 子代理 ──
    const agents: Record<string, unknown>[] = [
      { id: 'a1', name: '代码审查员', description: '审查代码质量', prompt: '你是严格的代码审查员。' },
    ];
    const agentOps: { op: string; id?: string; agent?: unknown }[] = [];
    // ── 定时任务 ──
    const schedules: Record<string, unknown>[] = scheduleSeed.map((item) => ({ ...item }));
    const scheduleOps: { op: string; id?: string; schedule?: unknown }[] = [];
    // ── 主题 ──
    const theme = { opacity: 1, backgroundImage: null, vars: {} as Record<string, string> };
    // ── 搜索 / 历史 ──
    const historyEntries: Record<string, unknown>[] = [
      { command: 'npm run dev', cwd: '/home/e2e/project', timestamp: Date.now() - 1000, exit_code: 0 },
      { command: 'git status', cwd: '/home/e2e/project', timestamp: Date.now() - 2000, exit_code: 0 },
      { command: 'echo hello-e2e', cwd: '/home/e2e', timestamp: Date.now() - 3000, exit_code: 0 },
    ];
    const searchCalls: { cmd: string; args: Record<string, unknown> }[] = [];
    const sshConnections: Record<string, unknown>[] = [
      { id: 'ssh-1', name: '生产服务器', host: 'prod.example.com', port: 22, user: 'root', password: '', authMethod: 'password', lastOpenedAt: null, hasPassword: true },
    ];
    const mockSessions: Record<string, unknown>[] = [
      { id: 't1', title: '终端', status: 'active', created_at: Date.now(), closed_at: null, block_count: 2, cwd: '', group_id: null, sort_order: 0, kind: 'local', payload: '{}' },
      { id: 'hist-1', title: '旧的调试会话', status: 'historical', created_at: Date.now() - 1000, closed_at: Date.now() - 500, block_count: 5, cwd: '', group_id: null, sort_order: 0, kind: 'local', payload: '{}' },
      ...(groupedHistoricalSession ? [{ id: 'hist-group-1', title: '归档分组中的会话', status: 'historical', created_at: Date.now() - 2000, closed_at: Date.now() - 1000, block_count: 1, cwd: '', group_id: 'archived-group', sort_order: 0, kind: 'local', payload: '{}' }] : []),
    ];
    const mockGroups: Record<string, unknown>[] = groupedHistoricalSession
      ? [{ id: 'archived-group', title: '已归档分组', sort_order: 0, collapsed: false, created_at: Date.now() - 3000, session_count: 0, archived: true }]
      : [];
    const mockChatMessages: Record<string, unknown>[] = [];
    const mockConversations = JSON.parse(localStorage.getItem('e2e-conversations') || '[]') as Record<string, unknown>[];
    const mockConversationMessages = JSON.parse(localStorage.getItem('e2e-conversation-messages') || '[]') as Record<string, unknown>[];
    const saveConversations = () => {
      localStorage.setItem('e2e-conversations', JSON.stringify(mockConversations));
      localStorage.setItem('e2e-conversation-messages', JSON.stringify(mockConversationMessages));
    };
    const sessionPayloads: { id: string; payload: string }[] = [];
    let pendingCmd = '';
    let integrationEnabled = enableIntegration;
    let sshSession = false;
    (window as unknown as Record<string, unknown>).__AI_MODELS__ = aiModels;
    (window as unknown as Record<string, unknown>).__PTY_WRITES__ = writes;
    (window as unknown as Record<string, unknown>).__CLIPBOARD_TEXT__ = clipboardText;
    (window as unknown as Record<string, unknown>).__PTY_SIGNALS__ = signals;
    (window as unknown as Record<string, unknown>).__PTY_RESIZES__ = resizes;
    (window as unknown as Record<string, unknown>).__FS_OPS__ = fsOps;
    (window as unknown as Record<string, unknown>).__SSH_OPS__ = sshOps;
    (window as unknown as Record<string, unknown>).__DOWNLOADS__ = downloads;
    (window as unknown as Record<string, unknown>).__REVEALED__ = revealed;
    (window as unknown as Record<string, unknown>).__OPENED__ = opened;
    (window as unknown as Record<string, unknown>).__SESSION_PAYLOADS__ = sessionPayloads;
    (window as unknown as Record<string, unknown>).__AI_KEY_CALLS__ = aiKeyCalls;
    (window as unknown as Record<string, unknown>).__AI_MODEL_CALLS__ = aiModelCalls;
    (window as unknown as Record<string, unknown>).__SKILL_OPS__ = skillOps;
    (window as unknown as Record<string, unknown>).__MCP_SERVERS__ = mcpServers;
    (window as unknown as Record<string, unknown>).__MCP_OPS__ = mcpOps;
    (window as unknown as Record<string, unknown>).__MEMORY__ = memory;
    (window as unknown as Record<string, unknown>).__MEMORY_OPS__ = memoryOps;
    (window as unknown as Record<string, unknown>).__AGENTS__ = agents;
    (window as unknown as Record<string, unknown>).__AGENT_OPS__ = agentOps;
    (window as unknown as Record<string, unknown>).__SCHEDULES__ = schedules;
    (window as unknown as Record<string, unknown>).__SCHEDULE_OPS__ = scheduleOps;
    (window as unknown as Record<string, unknown>).__THEME__ = theme;
    (window as unknown as Record<string, unknown>).__SEARCH_CALLS__ = searchCalls;

    const A = '\x1b]133;A\x07';
    const C = '\x1b]133;C\x07';
    const D = (ec: number) => `\x1b]133;D;${ec}\x07`;
    const E = (cmd: string) => `\x1b]133;E;${btoa(cmd)}\x07`;
    const G = (branch: string) => `\x1b]133;G;${btoa(branch)}\x07`;
    const OSC7 = (p: string) => `\x1b]7;file://host${p}\x07`;

    function emit(event: string, payload: unknown) {
      const cbId = eventListeners.get(event);
      if (cbId !== undefined) {
        (window as unknown as Record<string, (e: unknown) => void>)[`_${cbId}`]?.({ event, id: 0, payload });
      }
    }

    /** Alt-screen CSI direction: true = enter (h), false = exit (l), null = not alt.
     *  Inspects every parameter so a mode combined with other DEC private modes is recognized. */
    function altDirection(seq: string): boolean | null {
      if (!seq.startsWith('\x1b[?')) return null;
      const body = seq.slice(3);
      const finalByte = body.slice(-1);
      if (finalByte !== 'h' && finalByte !== 'l') return null;
      if (!body.slice(0, -1).split(';').some(param => param === '1049' || param === '1047' || param === '47')) return null;
      return finalByte === 'h';
    }

    /** 极简 OSC/alt 扫描器：把 raw 字节流切成前端 `DispatchEvent`（对应 Rust StreamScanner）。 */
    function scanEvents(chunk: string): { kind: string; text?: string; code?: string; payload?: string; raw?: string }[] {
      const events: { kind: string; text?: string; code?: string; payload?: string; raw?: string }[] = [];
      const flushData = (end: number) => {
        if (end > textStart) events.push({ kind: 'data', text: chunk.slice(textStart, end) });
      };
      let textStart = 0;
      let i = 0;
      while (i < chunk.length) {
        if (chunk.charCodeAt(i) !== 0x1b) { i++; continue; }
        if (i + 1 >= chunk.length) break;
        const next = chunk[i + 1]!;
        if (next === ']') {
          const rest = chunk.slice(i + 2);
          const bel = rest.indexOf('\x07');
          const st = rest.indexOf('\x1b\\');
          let end = -1;
          let termLen = 0;
          if (bel !== -1 && (st === -1 || bel < st)) { end = i + 2 + bel; termLen = 1; }
          else if (st !== -1) { end = i + 2 + st; termLen = 2; }
          else break;
          const raw = chunk.slice(i, end + termLen);
          const body = chunk.slice(i + 2, end);
          const semi = body.indexOf(';');
          let code = body;
          let payload = '';
          if (semi !== -1) {
            const num = body.slice(0, semi);
            const rest2 = body.slice(semi + 1);
            if (num === '133') {
              const semi2 = rest2.indexOf(';');
              if (semi2 === -1) { code = `133;${rest2}`; }
              else { code = `133;${rest2.slice(0, semi2)}`; payload = rest2.slice(semi2 + 1); }
            } else {
              code = num;
              payload = rest2;
            }
          }
          flushData(i);
          events.push({ kind: 'osc', code, payload, raw });
          i = end + termLen;
          textStart = i;
        } else if (next === '[') {
          let j = i + 2;
          while (j < chunk.length && /[0-9;?]/.test(chunk[j]!)) j++;
          if (j >= chunk.length) break;
          const seq = chunk.slice(i, j + 1);
          const alt = altDirection(seq);
          if (alt !== null) {
            flushData(i);
            events.push({ kind: alt ? 'altEnter' : 'altExit', raw: seq });
            textStart = j + 1;
          }
          i = j + 1;
        } else {
          i++;
        }
      }
      flushData(chunk.length);
      return events;
    }

    function emitOutput(data: string) {
      const events = scanEvents(data);
      setTimeout(() => emit('pty-output', { id: 'e2e-session', events }), 10);
    }

    /** 发送初始 prompt，把场景从 classic 切到 blockList。
     *  顺序与真实 RC 一致（shell_integration.rs：OSC7 → D → A → G），防 cwd 归属回归。 */
    function emitInitialPrompt() {
      if (!integrationEnabled) return;
      const ready = enableReadyMarker ? '\x1b]133;B\x07' : '';
      emitOutput(`${OSC7('/home/e2e/project')}${A}~/project${G('main')} $ ${ready}`);
    }

    /** 发送 OSC 133 序列模拟 shell integration 输出 */
    function emitOsc133(data: string): string[] {
      if (!integrationEnabled) {
        return [data];
      }

      // 累积命令文本直到收到换行
      pendingCmd += data;
      if (!pendingCmd.includes('\n') && !pendingCmd.includes('\r')) return [];

      const lines = pendingCmd.split(/[\r\n]+/);
      pendingCmd = lines.pop() ?? '';
      const results: string[] = [];

      for (const cmd of lines) {
        if (!cmd.trim()) continue;
        const clean = cmd.trim();
        const output = generateOutput(clean);
        if (!sshSession || sshPreexec) {
          results.push(E(clean));
          results.push(C);
        }
        if (output) results.push(`${output}\r\n`);
        // 与真实 RC 同序：OSC7 在 D/A 之前
        results.push(OSC7('/home/e2e/project'));
        results.push(D(0));
        results.push(`${A}~/project${G('main')} $ `);
      }
      return results;
    }

    /** 为几个固定命令生成可断言的输出 */
    function generateOutput(cmd: string): string {
      if (cmd === 'echo hello-e2e') return 'hello-e2e';
      if (cmd === 'echo e2e-block-test') return 'e2e-block-test';
      if (cmd.startsWith('echo ')) return cmd.slice(5);
      if (cmd === 'pwd') return '/home/e2e/project';
      if (cmd === 'ls') return 'Documents Downloads notes.txt';
      return '';
    }

    function buildOpenAiSse(text: string): string {
      const pieces: string[] = [];
      for (let i = 0; i < text.length; i += 24) pieces.push(text.slice(i, i + 24));
      const lines = [
        'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"gpt-4o-mini","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}',
      ];
      for (const p of pieces) {
        lines.push(`data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":${JSON.stringify(p)},"role":"assistant"},"finish_reason":null}]}`);
      }
      lines.push('data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}');
      lines.push('data: [DONE]');
      return lines.join('\n\n') + '\n\n';
    }

    function buildAnthropicSse(text: string): string {
      const start = {
        type: 'message_start',
        message: { id: 'msg_01', type: 'message', role: 'assistant', content: [], model: 'claude-sonnet-5', stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } },
      };
      const blockStart = { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
      const pieces: string[] = [];
      for (let i = 0; i < text.length; i += 24) pieces.push(text.slice(i, i + 24));
      const lines = [
        `event: message_start\ndata: ${JSON.stringify(start)}`,
        `event: content_block_start\ndata: ${JSON.stringify(blockStart)}`,
      ];
      for (const p of pieces) {
        lines.push(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: p } })}`);
      }
      lines.push(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}`);
      lines.push(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } })}`);
      lines.push('event: message_stop\ndata: {"type":"message_stop"}');
      return lines.join('\n\n') + '\n\n';
    }

    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, windows: [{ label: 'main' }] },
      transformCallback: (cb: (r: unknown) => void, once = false) => {
        const id = ++cbCounter;
        (window as unknown as Record<string, unknown>)[`_${id}`] = (response: unknown) => {
          cb(response);
          if (once) delete (window as unknown as Record<string, unknown>)[`_${id}`];
        };
        return id;
      },
      unregisterCallback: (id: number) => {
        delete (window as unknown as Record<string, unknown>)[`_${id}`];
      },
      convertFileSrc: (p: string) => p,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      invoke: async (cmd: string, args: any) => {
        switch (cmd) {
          case 'pty_spawn': {
            spawns.push(args);
            sshSession = Boolean(args.ssh);
            // 注册完 listener 后再发初始 prompt，避免瞬间丢失
            setTimeout(emitInitialPrompt, 20);
            return 'e2e-session';
          }
          case 'pty_write': {
            writes.push(args.data as string);
            // 假 shell + OSC 133 shell integration
            const chunks = emitOsc133(args.data as string);
            const data = chunks.length > 0 ? chunks.join('') : (args.data as string);
            emitOutput(data);
            return undefined;
          }
          case 'pty_resize':
            resizes.push({ cols: args.cols as number, rows: args.rows as number });
            return undefined;
          case 'pty_close':
            closes.push({ id: args.id });
            return undefined;
          case 'plugin:clipboard-manager|write_text':
            clipboardText = args.text as string;
            (window as unknown as Record<string, string>).__CLIPBOARD_TEXT__ = clipboardText;
            return undefined;
          case 'plugin:clipboard-manager|read_text':
            // Tests may seed the clipboard by assigning __CLIPBOARD_TEXT__ before pasting.
            return (window as unknown as Record<string, string>).__CLIPBOARD_TEXT__ ?? clipboardText;
          case 'plugin:clipboard-manager|read_image':
            if ((window as unknown as { __CLIPBOARD_IMAGE__?: boolean }).__CLIPBOARD_IMAGE__) return 700;
            throw new Error('No clipboard image');
          case 'plugin:resources|close':
            return undefined;
          case 'clipboard_write_files': {
            clipboardFiles = { paths: args.paths as string[], mode: args.mode as string };
            (window as unknown as Record<string, unknown>).__CLIPBOARD_FILES__ = clipboardFiles;
            return undefined;
          }
          case 'clipboard_read_files':
            return clipboardFiles?.paths ?? [];
          case 'pty_kill_foreground': {
            const id = args.id as string;
            const now = Date.now();
            const last = killAttempts.get(id);
            const escalate = last !== undefined && now - last < 3000;
            killAttempts.set(id, now);
            const sig = escalate ? 9 : 15;
            signals.push({ id, sig });
            return escalate ? 'kill' : 'term';
          }
          case 'ai_stream': {
            const id = args.id as string;
            const text = (window as unknown as Record<string, string>).__AI_REPLY__ ?? '';
            return new Promise<void>((resolve) => {
              const chunks: string[] = [];
              for (let i = 0; i < text.length; i += 24) chunks.push(text.slice(i, i + 24));
              let idx = 0;
              const next = () => {
                if (idx >= chunks.length) { resolve(); return; }
                emit('ai-chunk', { id, text: chunks[idx] });
                idx += 1;
                setTimeout(next, 20);
              };
              setTimeout(next, 10);
            });
          }
          case 'llm_stream': {
            // AI SDK 代理流：后端侧是「按回调 id 推事件」；浏览器 mock 等价于
            // 调 window[`_${id}`]({ index, message })，Channel 内部按 index 保序 + end 清理。
            // 按请求 URL 区分 Anthropic / OpenAI 的 SSE 格式。
            const raw = args.onEvent as unknown;
            const idStr =
              typeof raw === 'string' ? raw : ((raw as { toJSON?: () => string })?.toJSON?.() ?? String(raw));
            const m = /__CHANNEL__:(\d+)/.exec(idStr);
            const cbId = m ? Number(m[1]) : null;
            const text = (window as unknown as Record<string, string>).__AI_REPLY__ ?? '';
            const url = (args.req as { url?: string })?.url ?? '';
            searchCalls.push({ cmd: 'llm_stream', args: { url, method: (args.req as { method?: string })?.method } });
            const isAnthropic = /anthropic|\/v1\/messages/.test(url);
            // generateText 走非流式 JSON；streamText 走 SSE（请求体带 "stream":true）
            const reqBody = (args.req as { body?: string })?.body ?? '';
            const wantsStream = /"stream"\s*:\s*true/.test(reqBody);
            const streamId = String((args as { id?: unknown }).id ?? '');
            const chunkDelayMs = Number((window as unknown as Record<string, number>).__AI_CHUNK_DELAY_MS__ ?? 0);
            setTimeout(() => {
              if (cbId === null) return;
              const win = window as unknown as Record<string, (msg: { index: number; message?: unknown; end?: boolean }) => void>;
              let idx = 0;
              const send = (message: unknown) => win[`_${cbId}`]?.({ index: idx++, message });
              const pieces: unknown[] = [];
              let body: string;
              if (!wantsStream) {
                pieces.push({ kind: 'started', status: 200, headers: [['content-type', 'application/json']] });
                const completion = {
                  id: 'chatcmpl-1', object: 'chat.completion', model: 'gpt-4o-mini',
                  choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
                  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
                };
                body = JSON.stringify(completion);
              } else {
                pieces.push({ kind: 'started', status: 200, headers: [['content-type', 'text/event-stream']] });
                body = isAnthropic ? buildAnthropicSse(text) : buildOpenAiSse(text);
              }
              const b64 = btoa(unescape(encodeURIComponent(body)));
              for (let i = 0; i < b64.length; i += 64) {
                pieces.push({ kind: 'chunk', data: b64.slice(i, i + 64) });
              }
              pieces.push({ kind: 'done' });
              const finish = () => win[`_${cbId}`]?.({ index: idx, end: true });
              if (chunkDelayMs <= 0) {
                // Default: the whole answer arrives at once.
                for (const piece of pieces) send(piece);
                finish();
                return;
              }
              // A paced stream keeps the answer in flight long enough for a test to press Stop. An
              // aborted request stops sending without a terminal event, exactly like the Rust proxy.
              const flush = () => {
                if ((window as unknown as { __LLM_ABORTED__?: Set<string> }).__LLM_ABORTED__?.has(streamId)) return;
                const piece = pieces.shift();
                if (piece === undefined) { finish(); return; }
                send(piece);
                setTimeout(flush, chunkDelayMs);
              };
              flush();
            }, 10);
            return new Promise(() => {});
          }
          case 'llm_abort': {
            // Rust cancels the request and returns silently, so the frontend stream settles on its
            // own through llmFetch's abort listener.
            const aborted = ((window as unknown as { __LLM_ABORTED__?: Set<string> }).__LLM_ABORTED__ ??= new Set<string>());
            aborted.add(String((args as { id?: unknown }).id ?? ''));
            return undefined;
          }
          case 'get_ai_config':
            return {
              has_key: aiConfig.hasKey,
              base_url: aiConfig.baseUrl,
              model: aiConfig.model,
              provider: aiProvider,
              has_anthropic_key: aiHasAnthropic,
              has_gemini_key: aiHasGemini,
              has_tavily_key: aiHasTavily,
              models: aiModels,
              active_model: aiActive,
            };
          case 'set_ai_key':
            aiConfig.hasKey = true;
            return undefined;
          case 'clear_ai_key':
            aiConfig.hasKey = false;
            return undefined;
          case 'set_ai_base_url':
            aiConfig.baseUrl = args.baseUrl as string;
            return undefined;
          case 'set_ai_model':
            aiConfig.model = args.model as string;
            return undefined;
          case 'set_ai_provider':
            aiProvider = args.provider as string;
            return undefined;
          case 'set_ai_models': {
            aiModels.splice(0, aiModels.length, ...(args.models as typeof aiModels));
            aiActive = args.activeModel as string;
            const selected = aiModels.find(model => model.id === aiActive);
            if (selected) {
              aiProvider = selected.provider;
              aiConfig.baseUrl = selected.baseUrl;
              aiConfig.model = selected.model;
            }
            aiModelCalls.push({ kind: 'set_models', models: args.models as unknown[], active: args.activeModel as string });
            return undefined;
          }
          case 'set_active_model': {
            aiActive = args.id as string;
            const selected = aiModels.find(model => model.id === aiActive);
            if (selected) {
              aiProvider = selected.provider;
              aiConfig.baseUrl = selected.baseUrl;
              aiConfig.model = selected.model;
            }
            aiModelCalls.push({ kind: 'set_active', id: args.id as string });
            return undefined;
          }
          case 'set_provider_key': {
            aiKeyCalls.push({ provider: args.provider as string, key: args.key as string });
            if (args.provider === 'anthropic') aiHasAnthropic = true;
            else if (args.provider === 'gemini') aiHasGemini = true;
            else aiConfig.hasKey = true;
            return undefined;
          }
          case 'clear_provider_key': {
            aiKeyCalls.push({ provider: args.provider as string });
            if (args.provider === 'anthropic') aiHasAnthropic = false;
            else if (args.provider === 'gemini') aiHasGemini = false;
            else aiConfig.hasKey = false;
            return undefined;
          }
          case 'set_tavily_key':
            aiHasTavily = true;
            aiKeyCalls.push({ provider: 'tavily', key: args.key as string });
            return undefined;
          case 'clear_tavily_key':
            aiHasTavily = false;
            return undefined;
          case 'web_search':
            searchCalls.push({ cmd: 'web_search', args });
            return { results: [{ title: 'Rust 官网', url: 'https://www.rust-lang.org', content: 'A language empowering everyone' }] };
          case 'web_fetch':
            searchCalls.push({ cmd: 'web_fetch', args });
            return { title: 'Rust 文档', url: args.url, text: '# 欢迎\n这是抓取到的正文', links: [{ text: '入门', url: 'https://doc.rust-lang.org/book' }] };
          case 'web_crawl':
            searchCalls.push({ cmd: 'web_crawl', args });
            return { pages: [{ title: '首页', url: args.startUrl, text: '爬到的第一页' }], truncated: false };
          // ── 技能系统 ──
          case 'list_skills':
            return skills.map((s) => ({ ...s }));
          case 'get_skill': {
            const sk = skills.find((s) => s.name === args.name);
            if (!sk) throw new Error(`未找到技能「${args.name}」`);
            return sk;
          }
          case 'set_skill_state': {
            const sk = skills.find((s) => s.name === args.name);
            if (sk) {
              if (args.trusted !== null && args.trusted !== undefined) sk.trusted = args.trusted;
              if (args.enabled !== null && args.enabled !== undefined) sk.enabled = args.enabled;
            }
            skillOps.push({ op: 'set_state', name: args.name as string, trusted: args.trusted as boolean | null, enabled: args.enabled as boolean | null });
            return undefined;
          }
          case 'remove_skill': {
            const i = skills.findIndex((s) => s.name === args.name);
            if (i >= 0) skills.splice(i, 1);
            skillOps.push({ op: 'remove', name: args.name as string });
            return undefined;
          }
          case 'install_skill_md': {
            const meta = { name: args.name, description: args.description, source: 'url', trusted: false, enabled: false, hasScripts: false, modified: false, files: ['SKILL.md'], dir: `/home/e2e/.vrykell/skills/${args.name}`, prompt: args.prompt };
            const i = skills.findIndex((s) => s.name === args.name);
            if (i >= 0) skills[i] = meta; else skills.push(meta);
            skillOps.push({ op: 'install', name: args.name as string, prompt: args.prompt as string });
            return meta;
          }
          case 'read_skill_file':
            return `# ${args.relativePath}\n这是技能文件 ${args.name}/${args.relativePath} 的内容。`;
          case 'fetch_skill_registry':
            return [
              { name: '远程技能A', description: '来自 URL 的技能', prompt: '步骤…' },
              { name: '远程技能B', description: '另一个技能', prompt: '步骤…' },
            ];
          case 'import_skills_from_path':
            return [{ name: '导入技能', description: '从目录导入', source: 'local', trusted: false, enabled: false, hasScripts: false, modified: false, files: ['SKILL.md'], dir: args.path, prompt: '导入的正文' }];
          case 'find_skill_reference':
            return null;
          case 'market_github_list':
            return [
              { name: 'github-skill-1', dir: 'skills/github-skill-1', description: 'GitHub 操作技能' },
              { name: 'github-skill-2', dir: 'skills/github-skill-2', description: '第二个仓库技能' },
            ];
          case 'market_github_install': {
            const meta = { name: (args.dir as string).split('/').pop(), description: '来自市场', source: 'market', trusted: false, enabled: false, hasScripts: false, modified: false, files: ['SKILL.md'], dir: `/home/e2e/.vrykell/skills/${(args.dir as string).split('/').pop()}`, prompt: '市场安装的正文' };
            skills.push(meta);
            skillOps.push({ op: 'market_install', name: meta.name as string });
            return meta;
          }
          // ── MCP ──
          case 'mcp_get_servers':
            return mcpServers.map((s) => ({ ...s }));
          case 'mcp_save_server': {
            const cfg = args.config as Record<string, unknown>;
            const existing = mcpServers.find((s) => s.name === cfg.name);
            const stored = { ...cfg, connected: existing?.connected ?? false, toolCount: existing?.toolCount ?? 0 };
            if (existing) Object.assign(existing, stored);
            else mcpServers.push(stored);
            mcpOps.push({ op: 'save', name: cfg.name as string, config: cfg });
            return undefined;
          }
          case 'mcp_remove_server': {
            const i = mcpServers.findIndex((s) => s.name === args.name);
            if (i >= 0) mcpServers.splice(i, 1);
            mcpOps.push({ op: 'remove', name: args.name as string });
            return undefined;
          }
          case 'mcp_toggle_server': {
            const s = mcpServers.find((x) => x.name === args.name);
            if (s) s.enabled = args.enabled;
            mcpOps.push({ op: 'toggle', name: args.name as string });
            return undefined;
          }
          case 'mcp_connect': {
            const s = mcpServers.find((x) => x.name === args.name);
            if (s) { s.connected = true; s.toolCount = 2; }
            mcpOps.push({ op: 'connect', name: args.name as string });
            return undefined;
          }
          case 'mcp_disconnect': {
            const s = mcpServers.find((x) => x.name === args.name);
            if (s) s.connected = false;
            mcpOps.push({ op: 'disconnect', name: args.name as string });
            return undefined;
          }
          case 'mcp_list_all_tools':
            return [{ server: '文件系统', name: 'read_file', description: '读取文件' }];
          case 'mcp_call_tool':
            return { ok: true, result: 'mcp 工具结果' };
          // ── 记忆 ──
          case 'get_memory':
            return memory.fact;
          case 'set_memory':
            memory.fact = args.content as string;
            memoryOps.push({ op: 'set', content: args.content as string });
            return undefined;
          case 'get_memory_journal':
            return memory.journal;
          case 'append_memory_journal':
            memory.journal = `${memory.journal}\n${args.text}`;
            memoryOps.push({ op: 'append', text: args.text as string });
            return undefined;
          // ── 子代理 ──
          case 'list_agents':
            return agents.map((a) => ({ ...a }));
          case 'save_agent': {
            const a = args.agent as Record<string, unknown>;
            const existing = agents.find((x) => x.id === a.id && a.id !== '');
            const id = (a.id as string) || `a${Date.now().toString(36)}`;
            const stored = { ...a, id };
            if (existing) Object.assign(existing, stored); else agents.push(stored);
            agentOps.push({ op: 'save', id, agent: stored });
            return undefined;
          }
          case 'remove_agent': {
            const i = agents.findIndex((x) => x.id === args.id);
            if (i >= 0) agents.splice(i, 1);
            agentOps.push({ op: 'remove', id: args.id as string });
            return undefined;
          }
          case 'get_agent':
            return agents.find((x) => x.id === args.nameOrId || x.name === args.nameOrId) ?? { id: 'x', name: args.nameOrId, description: '', prompt: '' };
          // ── 定时任务 ──
          case 'list_schedules':
            return schedules.map((s) => ({ ...s }));
          case 'save_schedule': {
            const s = args.schedule as Record<string, unknown>;
            const existing = schedules.find((x) => x.id === s.id && s.id !== '');
            const id = (s.id as string) || `s${Date.now().toString(36)}`;
            const stored = { ...s, id };
            if (existing) Object.assign(existing, stored); else schedules.push(stored);
            scheduleOps.push({ op: 'save', id, schedule: stored });
            return undefined;
          }
          case 'remove_schedule': {
            const i = schedules.findIndex((x) => x.id === args.id);
            if (i >= 0) schedules.splice(i, 1);
            scheduleOps.push({ op: 'remove', id: args.id as string });
            return undefined;
          }
          case 'mark_schedule_run': {
            const s = schedules.find((x) => x.id === args.id);
            if (s) s.lastRunAt = args.timestamp;
            return undefined;
          }
          // ── 主题 ──
          case 'get_theme_config':
            return theme;
          case 'set_theme_config':
            Object.assign(theme, args.config);
            return undefined;
          case 'theme_export':
            return undefined;
          case 'theme_import': {
            const cfg = args.config ?? theme;
            Object.assign(theme, cfg);
            return theme;
          }
          case 'get_theme_path':
            return '/home/e2e/.vrykell/theme.json';
          // ── 搜索 / 历史 ──
          case 'search_files':
            searchCalls.push({ cmd: 'search_files', args });
            return [{ path: '/home/e2e/project/notes.txt', name: 'notes.txt', is_dir: false, size: 1234, modified: Date.now() - 3600_000, line: null, snippet: null }];
          case 'search_history':
            searchCalls.push({ cmd: 'search_history', args });
            return historyEntries;
          case 'search_blocks':
            searchCalls.push({ cmd: 'search_blocks', args });
            return [{ id: 'b1', session_id: 'hist-1', pane_id: null, command: 'npm run dev', output_raw: 'o', output_clean: 'dev server running', exit_code: 0, status: 'done', started_at: Date.now() - 60000, ended_at: Date.now() - 59000, session_title: '终端', session_status: 'historical' }];
          case 'search_sessions':
            searchCalls.push({ cmd: 'search_sessions', args });
            return [{ id: 't1', title: 'npm run dev', status: 'active', created_at: Date.now(), closed_at: null, block_count: 2, cwd: '', group_id: null, sort_order: 0, kind: 'local', payload: '{}' }];
          case 'get_search_context':
            return { cwd: args.cwd ?? '/home/e2e' };
          case 'shell_launch_directory': return launchDirectory ?? null;
          case 'context_menu_status': return { ...menu };
          case 'context_menu_manage': {
            const action = args.action as string;
            menuActions.push(action);
            if (action === 'trust') menu.certificateTrusted = true;
            if (action === 'untrust') menu.certificateTrusted = false;
            if (action === 'enable') {
              if (!menu.certificateTrusted) throw new Error('Certificate trust required');
              menu.enabled = true;
              menu.stale = false;
            }
            if (action === 'disable') menu.enabled = false;
            return { ...menu };
          }
          case 'record_history':
            historyEntries.unshift({ command: args.command, cwd: args.cwd, timestamp: args.timestamp, exit_code: args.exitCode });
            return undefined;
          case 'history_stats':
            return historyEntries.slice(0, args.topN ?? 20);
          case 'clear_history':
            historyEntries.length = 0;
            return undefined;
          case 'save_attachment':
            return { name: args.name as string, blob_path: `/home/e2e/.vrykell/attachments/${args.name}`, text: null, size: 123, mime: 'image/png' };
          case 'import_attachment':
            return { name: (args.path as string).split('/').pop() ?? 'file', blob_path: args.path as string, text: 'Test attachment content', size: 123, mime: 'text/plain' };
          case 'read_attachment':
            return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSFAAAAAASUVORK5CYII=';
          case 'fs_roots':
            return [
              { name: 'Documents', path: '/home/e2e/Documents', is_dir: true },
              { name: 'Downloads', path: '/home/e2e/Downloads', is_dir: true },
              { name: 'notes.txt', path: '/home/e2e/notes.txt', is_dir: false },
            ];
          case 'fs_home':
            return '/home/e2e';
          case 'list_shells':
            return [
              { id: 'zsh', label: 'Zsh', default: true },
              { id: 'bash', label: 'Bash', default: false },
            ];
          case 'ssh_connections_list':
            return sshConnections;
          case 'ssh_config_candidates':
            return [
              { name: 'web', host: '10.0.0.5', user: 'deploy', port: 2222, identityFile: '/keys/web', localForwards: ['8080:localhost:80'], remoteForwards: [], dynamicForwards: [] },
              { name: 'db', host: 'db.internal', user: '', port: 22, localForwards: [], remoteForwards: [], dynamicForwards: [] },
            ];
          case 'ssh_host_key_info':
            if (sshHost === 'changed') throw new Error('主机密钥不匹配，请核对远端主机');
            return { known: hostKnown, fingerprint: 'SHA256:e2e-verified-key', keyType: 'ed25519' };
          case 'ssh_trust_host_key':
            sshTrusts.push(args);
            hostKnown = true;
            return undefined;
          case 'plugin:dialog|message':
            dialogs.push(args);
            if (args.buttons?.OkCancelCustom) return args.buttons.OkCancelCustom[sshTrustConfirmed ? 0 : 1];
            return sshTrustConfirmed ? 'Yes' : 'No';
          case 'ssh_connection_save': {
            const conn = args.conn as Record<string, unknown>;
            const idx = sshConnections.findIndex((c) => c.id === conn.id);
            const existing = idx >= 0 ? sshConnections[idx] : null;
            const stored = {
              ...conn,
              password: '',
              hasPassword: conn.password ? true : (existing?.hasPassword ?? false),
            };
            if (idx >= 0) sshConnections[idx] = stored;
            else sshConnections.push(stored);
            return undefined;
          }
          case 'ssh_connection_delete':
            for (let i = sshConnections.length - 1; i >= 0; i--) {
              if (sshConnections[i]!.id === args.id) sshConnections.splice(i, 1);
            }
            return undefined;
          case 'ssh_connection_touch':
            sshConnections.forEach((c) => { if (c.id === args.id) c.lastOpenedAt = Date.now(); });
            return undefined;
          case 'ssh_test':
            if (args.host === 'bad.example.com') throw new Error('连接超时');
            return '连接成功';
          case 'ssh_system_status': {
            const globals = window as unknown as Record<string, unknown>;
            globals.__SSH_STATUS_CALLS__ = Number(globals.__SSH_STATUS_CALLS__ ?? 0) + 1;
            if (globals.__SSH_STATUS_ERROR__) throw new Error(String(globals.__SSH_STATUS_ERROR__));
            return { system: 'Linux 6.8', hostname: 'production-api', latencyMs: 42, uptimeSeconds: 1047600,
              load: '0.12 0.08 0.05', cpuTotal: Number(globals.__SSH_STATUS_CALLS__) * 1000,
              cpuIdle: Number(globals.__SSH_STATUS_CALLS__) * 880, memoryTotal: 8589934592,
              memoryAvailable: 6335076762, diskTotal: 107374182400, diskUsed: 40802189312 };
          }
          case 'ssh_list': {
            if (!hostKnown) throw new Error('HOST_KEY_UNKNOWN:SHA256:e2e-verified-key');
            const base = (args.path as string) || '/home/root';
            return {
              base,
              entries: [
                { name: 'Documents', path: `${base}/Documents`, is_dir: true },
                { name: 'app.log', path: `${base}/app.log`, is_dir: false },
                ...createdEntries,
              ],
            };
          }
          case 'ssh_stat': {
            const path = args.path as string;
            const created = createdEntries.find((item) => item.path === path);
            // app.log is the one file every mocked remote directory lists; other
            // unknown paths are treated as directories so navigation still works.
            const isDir = created ? created.is_dir : !path.endsWith('/app.log');
            return {
              name: path.split('/').filter(Boolean).pop() ?? path,
              path,
              is_dir: isDir,
              is_symlink: false,
              size: isDir ? 0 : 2048,
              created_ms: null,
              modified_ms: Date.UTC(2026, 0, 5, 6, 7, 8),
            };
          }
          case 'ssh_download': {
            const name = (args.path as string).split('/').pop() ?? 'file';
            const rec = {
              id: downloads.length + 1,
              name,
              localPath: `/tmp/${name}`,
              remotePath: args.path as string,
              connectionName: '生产服务器',
              isDir: false,
              size: 123,
              downloadedAt: Date.now(),
            };
            downloads.unshift(rec);
            return rec.localPath;
          }
          case 'downloads_list':
            return downloads;
          case 'downloads_clear':
            downloads.length = 0;
            return undefined;
          case 'plugin:opener|reveal_item_in_dir':
            revealed.push(...(args.paths as string[]));
            return undefined;
          case 'plugin:opener|open_path':
            opened.push(args.path as string);
            return undefined;
          case 'list_sessions':
            return mockSessions;
          case 'terminal_debug_status':
            return false;
          case 'diagnostics_set_auto_save':
          case 'terminal_debug_set':
            return args.enabled;
          case 'terminal_debug_record':
            diagnosticRecords.push(args);
            return undefined;
          case 'terminal_debug_records':
            diagnosticRecords.push(...(args.records as Record<string, unknown>[]));
            return undefined;
          case 'diagnostics_export':
            diagnosticsExports.push(args);
            return undefined;
          case 'diagnostics_log_directory':
            return '/home/e2e/.vrykell/logs';
          case 'plugin:dialog|save':
            return (args.options as Record<string, unknown> | undefined)?.defaultPath ?? '/home/e2e/vrykell-diagnostics.jsonl';
          case 'archive_session':
            { const session = mockSessions.find(item => item.id === args.id); if (session) session.status = 'historical'; }
            return undefined;
          case 'get_session':
            return mockSessions.find((s) => s.id === args.id) ?? null;
          case 'groups_list':
            return mockGroups;
          case 'group_create':
          case 'group_rename':
          case 'group_set_collapsed':
          case 'group_delete':
          case 'group_delete_with_sessions':
          case 'groups_reorder':
          case 'sessions_reorder':
          case 'group_restore':
            return undefined;
          case 'session_set_group': {
            const session = mockSessions.find((item) => item.id === args.sessionId);
            if (session) session.group_id = args.groupId ?? null;
            return undefined;
          }
          case 'delete_session': {
            const i = mockSessions.findIndex((s) => s.id === args.id);
            if (i >= 0) mockSessions.splice(i, 1);
            return undefined;
          }
          case 'get_session_blocks':
            if (args.sessionId === 'hist-1') {
              return [{ id: 'b1', session_id: 'hist-1', pane_id: null, command: 'ls -la', output_raw: 'o', output_clean: 'total 1', output_html: '<span style="color:#4e9a06">total 1</span>', exit_code: 0, status: 'done', started_at: 1, ended_at: 2, collapsed: true }];
            }
            return [];
          case 'update_session_payload':
            sessionPayloads.push({ id: args.id as string, payload: args.payload as string });
            return undefined;
          case 'list_conversations': return mockConversations;
          case 'save_conversation': {
            const entry = { id: args.id, title: args.title, created_at: args.createdAt, updated_at: args.updatedAt, environment: args.environment };
            const index = mockConversations.findIndex(item => item.id === args.id);
            if (index >= 0) mockConversations[index] = entry; else mockConversations.push(entry);
            saveConversations();
            return undefined;
          }
          case 'append_conversation_message': {
            const entry = { id: args.id, conversation_id: args.conversationId, role: args.role, content: args.content,
              created_at: args.createdAt, parts: args.parts, attachments: args.attachments, pane_id: args.paneId, context: args.context };
            const index = mockConversationMessages.findIndex(item => item.id === args.id);
            if (index >= 0) mockConversationMessages[index] = entry; else mockConversationMessages.push(entry);
            saveConversations();
            return undefined;
          }
          case 'list_conversation_messages': return mockConversationMessages.filter(item => item.conversation_id === args.id);
          case 'delete_conversation_message': {
            const index = mockConversationMessages.findIndex(item => item.id === args.id);
            if (index >= 0) mockConversationMessages.splice(index, 1);
            saveConversations(); return undefined;
          }
          case 'delete_conversation': {
            const index = mockConversations.findIndex(item => item.id === args.id);
            if (index >= 0) mockConversations.splice(index, 1);
            for (let position = mockConversationMessages.length - 1; position >= 0; position--) {
              if (mockConversationMessages[position].conversation_id === args.id) mockConversationMessages.splice(position, 1);
            }
            saveConversations(); return undefined;
          }
          case 'append_chat_message': {
            const i = mockChatMessages.findIndex((m) => m.id === args.id);
            const msg = { id: args.id, session_id: args.sessionId, role: args.role, content: args.content, created_at: args.createdAt };
            if (i >= 0) mockChatMessages[i] = msg; else mockChatMessages.push(msg);
            return undefined;
          }
          case 'list_chat_messages':
            return mockChatMessages
              .filter((m) => (m as Record<string, unknown>).session_id === args.sessionId)
              .map((m) => ({ id: m.id, role: m.role, content: m.content, created_at: m.created_at }));
          case 'file_open':
            return { via: 'terminal', command: `vim ${args.path}`, editor: 'vim' };
          case 'fs_list':
            return [
              { name: 'Documents', path: '/home/e2e/Documents', is_dir: true },
              { name: 'Downloads', path: '/home/e2e/Downloads', is_dir: true },
              { name: 'notes.txt', path: '/home/e2e/notes.txt', is_dir: false },
              // 新建出来的条目出现在列表里（模拟真实文件系统）
              ...createdEntries,
            ];
          case 'fs_disks':
            return [
              { name: 'e2e-root', path: '/', total_bytes: 500 * 1024 ** 3, free_bytes: 250 * 1024 ** 3 },
              { name: 'Backup', path: '/Volumes/Backup', total_bytes: 2 * 1024 ** 4, free_bytes: 1.5 * 1024 ** 4 },
            ];
          case 'fs_stat': {
            const path = args.path as string;
            const created = createdEntries.find((item) => item.path === path);
            // The mock serves the same flat layout for every directory: only the
            // listed files count as files so typed directory paths keep navigating.
            const isDir = created ? created.is_dir : path !== '/home/e2e/notes.txt';
            return {
              name: path.split('/').filter(Boolean).pop() ?? path,
              path,
              is_dir: isDir,
              is_symlink: false,
              size: isDir ? 0 : 1536,
              created_ms: Date.UTC(2026, 0, 2, 3, 4, 5),
              modified_ms: Date.UTC(2026, 0, 2, 3, 4, 5),
            };
          }
          case 'fs_rename': {
            fsOps.push({ op: 'rename', path: args.oldPath as string, newName: args.newName as string });
            const oldPath = args.oldPath as string;
            const parent = oldPath.slice(0, oldPath.lastIndexOf('/'));
            const name = args.newName as string;
            // 同名避让（真实实现在后端）：目标已被占用时返回带序号的路径
            const taken = ['Documents', 'Downloads', 'notes.txt'].includes(name)
              || createdEntries.some((item) => item.path === `${parent}/${name}`);
            return `${parent}/${taken ? `${name.replace(/(\.[^.]*)?$/, ' (1)$1')}` : name}`;
          }
          case 'fs_create_file':
          case 'fs_create_dir': {
            const dir = String(args.dir ?? '');
            const name = args.name as string;
            // 同名避让：真实后端会加序号并返回最终路径，mock 按已新建条目模拟
            let finalName = name;
            let path = `${dir}/${name}`;
            if (createdEntries.some((item) => item.path === path)) {
              const dot = name.lastIndexOf('.');
              const stem = dot > 0 ? name.slice(0, dot) : name;
              const ext = dot > 0 ? name.slice(dot) : '';
              let index = 1;
              while (createdEntries.some((item) => item.path === `${dir}/${stem} (${index})${ext}`)) index += 1;
              finalName = `${stem} (${index})${ext}`;
              path = `${dir}/${finalName}`;
            }
            fsOps.push({ op: cmd === 'fs_create_file' ? 'create-file' : 'create-dir', path });
            createdEntries.push({ name: finalName, path, is_dir: cmd === 'fs_create_dir' });
            return path;
          }
          case 'fs_copy':
          case 'fs_move': {
            const op = cmd === 'fs_copy' ? 'copy' : 'move';
            const paths = args.paths as string[];
            const destDir = args.destDir as string;
            for (const path of paths) fsOps.push({ op, path, destDir });
            return {
              completed: paths.map((path) => {
                const name = path.split('/').pop() ?? 'file';
                const candidate = `${destDir}/${name}`;
                // 同名避让（真实实现在后端）：目标已被占用时返回带序号的路径
                const taken = ['Documents', 'Downloads', 'notes.txt'].includes(name)
                  || createdEntries.some((item) => item.path === candidate);
                return { from: path, to: taken ? candidate.replace(/(\.[^.]*)?$/, ' (1)$1') : candidate };
              }),
              errors: [],
            };
          }
          case 'fs_stage_delete': {
            const paths = args.paths as string[];
            for (const path of paths) fsOps.push({ op: 'delete', path });
            return paths.map((path) => ({ from: path, to: `/home/e2e/.vrykell/undo/u-${path.split('/').pop()}` }));
          }
          case 'fs_restore_staged': {
            const items = args.items as { from: string; to: string }[];
            for (const item of items) fsOps.push({ op: 'restore', path: item.from });
            return { completed: items, errors: [] };
          }
          case 'fs_purge_staged': {
            for (const path of args.paths as string[]) fsOps.push({ op: 'purge', path });
            return undefined;
          }
          case 'ssh_rename': {
            sshOps.push({ op: 'rename', path: args.path as string, newName: args.newName as string });
            const oldPath = args.path as string;
            const parent = oldPath.slice(0, oldPath.lastIndexOf('/'));
            const name = args.newName as string;
            const taken = ['Documents', 'app.log'].includes(name)
              || createdEntries.some((item) => item.path === `${parent}/${name}`);
            return `${parent}/${taken ? `${name.replace(/(\.[^.]*)?$/, ' (1)$1')}` : name}`;
          }
          case 'ssh_create_file':
          case 'ssh_create_dir': {
            const dir = String(args.dir ?? '');
            const name = args.name as string;
            const path = `${dir}/${name}`;
            sshOps.push({ op: cmd === 'ssh_create_file' ? 'create-file' : 'create-dir', path });
            const created = { name, path, is_dir: cmd === 'ssh_create_dir' };
            createdEntries.push(created);
            return path;
          }
          case 'ssh_move': {
            sshOps.push({ op: 'move', path: args.path as string, destDir: args.destDir as string });
            const source = args.path as string;
            const name = source.split('/').pop();
            const dir = String(args.destDir);
            const candidate = `${dir === '/' ? '' : dir}/${name}`;
            // 目标已有同名项：返回带序号的真实目标路径（真实实现在后端）
            const taken = [...createdEntries, { name: 'app.log', path: `${dir}/app.log`, is_dir: false }]
              .some((item) => item.path === candidate);
            return taken ? candidate.replace(/(\.[^.]*)?$/, ' (1)$1') : candidate;
          }
          case 'ssh_copy': {
            const paths = args.paths as string[];
            const destDir = args.destDir as string;
            for (const path of paths) sshOps.push({ op: 'copy', path, destDir });
            return {
              completed: paths.map((path) => ({ from: path, to: `${destDir === '/' ? '' : destDir}/${path.split('/').pop()}` })),
              errors: [],
            };
          }
          case 'ssh_stage_delete': {
            const paths = args.paths as string[];
            for (const path of paths) sshOps.push({ op: 'delete', path });
            return {
              completed: paths.map((path) => ({ from: path, to: `/home/tester/.vrykell/undo/u-${path.split('/').pop()}` })),
              errors: [],
            };
          }
          case 'ssh_restore_staged': {
            const items = args.items as { from: string; to: string }[];
            for (const item of items) sshOps.push({ op: 'restore', path: item.from });
            return { completed: items, errors: [] };
          }
          case 'ssh_purge_staged': {
            for (const path of args.paths as string[]) sshOps.push({ op: 'purge', path });
            return undefined;
          }
          case 'ssh_sweep_undo':
            return undefined;
          case 'plugin:event|listen':
            eventListeners.set(args.event as string, args.handler as number);
            return 0;
          case 'plugin:event|unlisten':
            return undefined;
          case 'plugin:window|is_fullscreen':
            return fullscreen;
          default:
            return null;
        }
      },
      // 测试可直接注入任意 PTY 输出字节（如 altScreen 序列）
      emitPtyExit: (code: number | null) => emit('pty-exit', { id: 'e2e-session', code }),
      emitPtyOutput: (data: string) => {
        emitOutput(data);
      },
      setFullscreen: (value: boolean) => {
        fullscreen = value;
        emit('tauri://resize', { width: window.innerWidth, height: window.innerHeight });
      },
    };
    localStorage.setItem('vrykell-api-key', 'sk-e2e-fake');
  }, { enableIntegration: integration, enableReadyMarker: opts.shellReadyMarker !== false, models: seedModels, active: seedActive, skillsSeed: seedSkills, scheduleSeed: seedSchedules, sshHost: opts.sshHost ?? 'known', sshTrustConfirmed: opts.sshTrustConfirmed ?? true, sshPreexec: opts.sshPreexec ?? true, groupedHistoricalSession: opts.groupedHistoricalSession ?? false, launchDirectory: opts.launchDirectory, menuSeed: opts.contextMenu });
}

/** 预置 AI 回复文本：mock 的 ai_stream 会按 chunk 流式 emit ai-chunk 事件。
 *  AI 流式已下沉 Rust（invoke ai_stream + ai-chunk 事件），不再走浏览器 HTTP。 */
export async function mockAnthropic(page: Page, replyText: string) {
  await page.addInitScript((text: string) => {
    (window as unknown as Record<string, string>).__AI_REPLY__ = text;
  }, replyText);
}

/** Deliver the mocked answer one piece at a time, so a test can stop it while it is still arriving.
 *  Without this the whole answer lands at once and there is nothing left to abort. */
export async function paceLlmStream(page: Page, delayMs: number) {
  await page.addInitScript((ms: number) => {
    (window as unknown as Record<string, number>).__AI_CHUNK_DELAY_MS__ = ms;
  }, delayMs);
}

/** 读取假 PTY 收到的全部写入 */
export function ptyWrites(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as Record<string, string[]>).__PTY_WRITES__);
}

/** Read the native clipboard value captured by the Tauri mock. */
export function clipboardText(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as Record<string, string>).__CLIPBOARD_TEXT__ ?? '');
}

/** Read the file list the panel wrote to the system clipboard (captured by the Tauri mock). */
export function clipboardFiles(page: Page): Promise<{ paths: string[]; mode: string } | null> {
  return page.evaluate(
    () => (window as unknown as Record<string, { paths: string[]; mode: string } | undefined>).__CLIPBOARD_FILES__ ?? null,
  );
}

/** 读取 pty_signal 调用记录（结束按钮升级链路断言用） */
export function ptySignals(page: Page): Promise<{ id: string; sig: number }[]> {
  return page.evaluate(
    () => (window as unknown as Record<string, { id: string; sig: number }[]>).__PTY_SIGNALS__,
  );
}

/** 读取 pty_resize 调用记录（宽度跟随卡片断言用） */
export function ptyResizes(page: Page): Promise<{ cols: number; rows: number }[]> {
  return page.evaluate(
    () => (window as unknown as Record<string, { cols: number; rows: number }[]>).__PTY_RESIZES__,
  );
}

/** 读取文件面板调用的 fs_rename / fs_delete 记录（删除/重命名断言用） */
export function fsOps(page: Page): Promise<{ op: string; path: string; newName?: string }[]> {
  return page.evaluate(() => (window as unknown as Record<string, { op: string; path: string; newName?: string }[]>).__FS_OPS__);
}

/** 读取远程文件面板调用的 ssh_rename / ssh_move / ssh_copy / ssh_stage_delete 等记录 */
export function sshOps(page: Page): Promise<{ op: string; path: string; newName?: string; destDir?: string }[]> {
  return page.evaluate(() => (window as unknown as Record<string, { op: string; path: string; newName?: string }[]>).__SSH_OPS__);
}

/** 读取下载管理里「定位」调用的 reveal 路径记录 */
export function revealedPaths(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as Record<string, string[]>).__REVEALED__);
}

/** Paths handed to the system default application (plugin:opener|open_path). */
export function openedPaths(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as Record<string, string[]>).__OPENED__);
}

/** 读取 update_session_payload 记录（分屏布局持久化断言用） */
export function sessionPayloads(page: Page): Promise<{ id: string; payload: string }[]> {
  return page.evaluate(
    () => (window as unknown as Record<string, { id: string; payload: string }[]>).__SESSION_PAYLOADS__,
  );
}

/** 通过 mock 直接注入任意 PTY 输出 */
export async function emitPtyOutput(page: Page, data: string): Promise<void> {
  await page.evaluate((d) => {
    const internals = (window as unknown as Record<string, (data: string) => void>).__TAURI_INTERNALS__;
    internals?.emitPtyOutput(d);
  }, data);
}

/** 读取 set_provider_key / set_tavily_key 调用记录 */
export function aiKeyCalls(page: Page): Promise<{ provider: string; key?: string }[]> {
  return page.evaluate(() => (window as unknown as { __AI_KEY_CALLS__: { provider: string; key?: string }[] }).__AI_KEY_CALLS__);
}

/** 读取 set_ai_models / set_active_model 调用记录 */
export function aiModelCalls(page: Page): Promise<{ kind: string; models?: unknown[]; active?: string; id?: string }[]> {
  return page.evaluate(() => (window as unknown as { __AI_MODEL_CALLS__: { kind: string; models?: unknown[]; active?: string; id?: string }[] }).__AI_MODEL_CALLS__);
}

/** 读取技能操作记录（set_state/remove/install/market_install） */
export function skillOps(page: Page): Promise<{ op: string; name: string; trusted?: boolean | null; enabled?: boolean | null; prompt?: string }[]> {
  return page.evaluate(() => (window as unknown as { __SKILL_OPS__: { op: string; name: string; trusted?: boolean | null; enabled?: boolean | null; prompt?: string }[] }).__SKILL_OPS__);
}

/** 读取 MCP 服务器状态与操作记录 */
export function mcpServers(page: Page): Promise<Record<string, unknown>[]> {
  return page.evaluate(() => (window as unknown as { __MCP_SERVERS__: Record<string, unknown>[] }).__MCP_SERVERS__);
}
export function mcpOps(page: Page): Promise<{ op: string; name: string; config?: unknown }[]> {
  return page.evaluate(() => (window as unknown as { __MCP_OPS__: { op: string; name: string; config?: unknown }[] }).__MCP_OPS__);
}

/** 读取记忆操作记录 */
export function memoryOps(page: Page): Promise<{ op: string; content?: string; text?: string }[]> {
  return page.evaluate(() => (window as unknown as { __MEMORY_OPS__: { op: string; content?: string; text?: string }[] }).__MEMORY_OPS__);
}

/** 读取子代理操作记录 */
export function agentOps(page: Page): Promise<{ op: string; id?: string; agent?: unknown }[]> {
  return page.evaluate(() => (window as unknown as { __AGENT_OPS__: { op: string; id?: string; agent?: unknown }[] }).__AGENT_OPS__);
}

/** 读取定时任务操作记录 */
export function scheduleOps(page: Page): Promise<{ op: string; id?: string; schedule?: unknown }[]> {
  return page.evaluate(() => (window as unknown as { __SCHEDULE_OPS__: { op: string; id?: string; schedule?: unknown }[] }).__SCHEDULE_OPS__);
}

/** 读取搜索 invoke 调用记录 */
export function searchCalls(page: Page): Promise<{ cmd: string; args: Record<string, unknown> }[]> {
  return page.evaluate(() => (window as unknown as { __SEARCH_CALLS__: { cmd: string; args: Record<string, unknown> }[] }).__SEARCH_CALLS__);
}

/** 读取主题配置（get_theme_config / set_theme_config 之后的状态） */
export function themeConfig(page: Page): Promise<{ opacity: number; backgroundImage: string | null; vars: Record<string, string> }> {
  return page.evaluate(() => (window as unknown as { __THEME__: { opacity: number; backgroundImage: string | null; vars: Record<string, string> } }).__THEME__);
}

/** 读取记忆当前内容（FACT） */
export function memoryFact(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { __MEMORY__: { fact: string } }).__MEMORY__.fact);
}

/**
 * 读取指定 pane 主 xterm 的当前可见画面文本（WebGL renderer 下终端输出不进 DOM，
 * 测试用 getByText 读不到，改走 __vrykellTerms 注册表读 buffer）。
 * 返回 null 表示该 pane 无 xterm 实例。
 */
export async function readTermScreen(page: Page, paneId: string): Promise<string | null> {
  return page.evaluate((pid) => {
    const terms = (window as unknown as Record<string, Map<string, { buffer: { active: { viewportY: number; length: number; cursorY: number; getLine(y: number): { translateToString(t?: boolean): string } | undefined } } }>>).__vrykellTerms;
    const term = terms?.get(pid);
    if (!term) return null;
    const buf = term.buffer.active;
    const start = Math.max(0, buf.viewportY);
    const end = Math.min(buf.length - 1, start + 24 - 1);
    const lines: string[] = [];
    for (let i = start; i <= end; i++) {
      const line = buf.getLine(i);
      lines.push(line ? line.translateToString(true) : '');
    }
    while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
    return lines.join('\n');
  }, paneId);
}

/** 轮询直到 pane 的 xterm buffer 包含指定文本（WebGL 下替代 toContainText）。 */
export async function expectTermContains(page: Page, paneId: string, text: string, timeout = 5000): Promise<void> {
  const { expect } = await import('@playwright/test');
  await expect
    .poll(() => readTermScreen(page, paneId), { timeout, message: `pane ${paneId} 应包含「${text}」` })
    .toContain(text);
}

/** 读取所有已注册 xterm 的画面文本（用于测试不确定 paneId 的场景）。 */
export async function readAllTermScreens(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const terms = (window as unknown as Record<string, Map<string, { buffer: { active: { viewportY: number; length: number; getLine(y: number): { translateToString(t?: boolean): string } | undefined } } }>>).__vrykellTerms;
    if (!terms) return [];
    const out: string[] = [];
    terms.forEach((term) => {
      if (!term) return;
      const buf = term.buffer.active;
      const start = Math.max(0, buf.viewportY);
      const end = Math.min(buf.length - 1, start + 24 - 1);
      const lines: string[] = [];
      for (let i = start; i <= end; i++) {
        const line = buf.getLine(i);
        lines.push(line ? line.translateToString(true) : '');
      }
      while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
      out.push(lines.join('\n'));
    });
    return out;
  });
}

/** 轮询直到任一 pane 的 xterm buffer 包含指定文本。 */
export async function expectAnyTermContains(page: Page, text: string, timeout = 5000): Promise<void> {
  const { expect } = await import('@playwright/test');
  await expect
    .poll(() => readAllTermScreens(page).then((screens) => screens.some((s) => s.includes(text))), {
      timeout,
      message: `任一 pane 应包含「${text}」`,
    })
    .toBe(true);
}

/** 确保会话列表面板打开，兼容默认布局与按需打开状态。 */
export async function ensureTabsOpen(page: Page): Promise<void> {
  const search = page.locator('[data-testid="tab-search"]');
  if (!(await search.isVisible().catch(() => false))) {
    await page.locator('[data-dock-btn="tabs"]').click();
  }
  await search.waitFor({ state: 'visible' });
}

/** Expand the conversation configuration without changing the message draft. */
export async function ensureChatSettingsOpen(page: Page): Promise<void> {
  const trigger = page.getByRole('button', { name: '会话设置', exact: true });
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  await page.getByRole('region', { name: '会话设置' }).waitFor({ state: 'visible' });
}

/**
 * Returns the measured cell height used by completed-block snapshots.
 * Geometry assertions should compare against this value rather than hard-coded pixels.
 */
export async function terminalRowHeight(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const font = await import('/src/features/terminal/model/terminalFont.ts') as typeof import('../src/features/terminal/model/terminalFont');
    return font.measureTerminalDomCellHeight();
  });
}
