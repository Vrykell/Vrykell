import type { Page } from '@playwright/test';

export interface TauriMockOptions {
  /** 是否启用 OSC 133 shell integration（默认 true）。
   *  false 时 mock 保持 classic 场景，用于测试无 integration 回退。 */
  integration?: boolean;
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
  const seedSkills = opts.skills ?? [
    { name: '写单测', description: '为代码写单元测试', source: 'local', trusted: true, enabled: true, hasScripts: false, modified: false, files: ['SKILL.md'], dir: '/home/e2e/.vrykell/skills/写单测', prompt: '先看代码，再写 vitest 单测。' },
    { name: '旧脚本技能', description: '遗留技能，含脚本', source: 'market', trusted: false, enabled: false, hasScripts: true, modified: true, files: ['SKILL.md', 'scripts/run.sh', 'references/说明.md'], dir: '/home/e2e/.vrykell/skills/旧脚本技能', prompt: '运行 scripts/run.sh 完成工作。' },
  ];
  await page.addInitScript(
    ({ enableIntegration, models, active, skillsSeed }) => {
    let cbCounter = 0;
    const eventListeners = new Map<string, number>();
    const writes: string[] = [];
    const signals: { id: string; sig: number }[] = [];
    const killAttempts = new Map<string, number>();
    const resizes: { cols: number; rows: number }[] = [];
    const fsOps: { op: string; path: string; newName?: string }[] = [];
    const sshOps: { op: string; path: string; newName?: string }[] = [];
    const downloads: Record<string, unknown>[] = [];
    const revealed: string[] = [];
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
    const schedules: Record<string, unknown>[] = [
      { id: 's1', name: '每日巡检', prompt: '检查系统状态并汇报', intervalMinutes: 60, enabled: true, lastRunAt: 0 },
    ];
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
    ];
    const mockChatMessages: Record<string, unknown>[] = [];
    const sessionPayloads: { id: string; payload: string }[] = [];
    let pendingCmd = '';
    let integrationEnabled = enableIntegration;
    (window as unknown as Record<string, unknown>).__AI_MODELS__ = aiModels;
    (window as unknown as Record<string, unknown>).__PTY_WRITES__ = writes;
    (window as unknown as Record<string, unknown>).__PTY_SIGNALS__ = signals;
    (window as unknown as Record<string, unknown>).__PTY_RESIZES__ = resizes;
    (window as unknown as Record<string, unknown>).__FS_OPS__ = fsOps;
    (window as unknown as Record<string, unknown>).__SSH_OPS__ = sshOps;
    (window as unknown as Record<string, unknown>).__DOWNLOADS__ = downloads;
    (window as unknown as Record<string, unknown>).__REVEALED__ = revealed;
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
          const enter = /\x1b\[\?(1049|1047|47)h/.test(seq);
          const exit = /\x1b\[\?(1049|1047|47)l/.test(seq);
          if (enter || exit) {
            flushData(i);
            events.push({ kind: enter ? 'altEnter' : 'altExit', raw: seq });
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
      emitOutput(`${OSC7('/home/e2e/project')}${A}~/project${G('main')} $ `);
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
        results.push(E(clean));
        results.push(C);
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
            return undefined;
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
            setTimeout(() => {
              if (cbId === null) return;
              const win = window as unknown as Record<string, (msg: { index: number; message?: unknown; end?: boolean }) => void>;
              let idx = 0;
              const send = (message: unknown) => win[`_${cbId}`]?.({ index: idx++, message });
              let body: string;
              if (!wantsStream) {
                send({ kind: 'started', status: 200, headers: [['content-type', 'application/json']] });
                const completion = {
                  id: 'chatcmpl-1', object: 'chat.completion', model: 'gpt-4o-mini',
                  choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
                  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
                };
                body = JSON.stringify(completion);
              } else {
                send({ kind: 'started', status: 200, headers: [['content-type', 'text/event-stream']] });
                body = isAnthropic ? buildAnthropicSse(text) : buildOpenAiSse(text);
              }
              const b64 = btoa(unescape(encodeURIComponent(body)));
              for (let i = 0; i < b64.length; i += 64) {
                send({ kind: 'chunk', data: b64.slice(i, i + 64) });
              }
              send({ kind: 'done' });
              win[`_${cbId}`]?.({ index: idx, end: true });
            }, 10);
            return new Promise(() => {});
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
            aiModelCalls.push({ kind: 'set_models', models: args.models as unknown[], active: args.activeModel as string });
            return undefined;
          }
          case 'set_active_model': {
            aiActive = args.id as string;
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
            return [{ id: 'b1', session_id: 'hist-1', pane_id: null, command: 'npm run dev', output_raw: 'o', output_clean: 'dev server running', exit_code: 0, status: 'done', started_at: 1, ended_at: 2, collapsed: false }];
          case 'search_sessions':
            searchCalls.push({ cmd: 'search_sessions', args });
            return [{ id: 't1', title: 'npm run dev', status: 'active', created_at: Date.now(), closed_at: null, block_count: 2, cwd: '', group_id: null, sort_order: 0, kind: 'local', payload: '{}' }];
          case 'get_search_context':
            return { cwd: args.cwd ?? '/home/e2e' };
          case 'record_history':
            historyEntries.unshift({ command: args.command, cwd: args.cwd, timestamp: args.timestamp, exit_code: args.exitCode });
            return undefined;
          case 'history_stats':
            return historyEntries.slice(0, args.topN ?? 20);
          case 'clear_history':
            historyEntries.length = 0;
            return undefined;
          case 'save_attachment':
            return { id: `att-${Date.now()}`, name: args.name as string, path: `/home/e2e/.vrykell/attachments/${args.name}`, size: 123, mime: 'image/png' };
          case 'import_attachment':
            return { id: `att-${Date.now()}`, name: (args.path as string).split('/').pop() ?? 'file', path: args.path as string, size: 123, mime: 'application/octet-stream' };
          case 'read_attachment':
            return 'data:image/png;base64,aW1n';
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
          case 'ssh_list': {
            const base = (args.path as string) || '/home/root';
            return {
              base,
              entries: [
                { name: 'Documents', path: `${base}/Documents`, is_dir: true },
                { name: 'app.log', path: `${base}/app.log`, is_dir: false },
              ],
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
            return undefined;
          case 'list_sessions':
            return mockSessions;
          case 'get_session':
            return mockSessions.find((s) => s.id === args.id) ?? null;
          case 'groups_list':
            return [];
          case 'group_create':
          case 'group_rename':
          case 'group_set_collapsed':
          case 'group_delete':
          case 'group_delete_with_sessions':
          case 'groups_reorder':
          case 'session_set_group':
          case 'sessions_reorder':
          case 'group_restore':
            return undefined;
          case 'delete_session': {
            const i = mockSessions.findIndex((s) => s.id === args.id);
            if (i >= 0) mockSessions.splice(i, 1);
            return undefined;
          }
          case 'get_session_blocks':
            if (args.sessionId === 'hist-1') {
              return [{ id: 'b1', session_id: 'hist-1', pane_id: null, command: 'ls -la', output_raw: 'o', output_clean: 'total 1', exit_code: 0, status: 'done', started_at: 1, ended_at: 2, collapsed: false }];
            }
            return [];
          case 'update_session_payload':
            sessionPayloads.push({ id: args.id as string, payload: args.payload as string });
            return undefined;
          case 'set_block_collapsed':
            return undefined;
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
            ];
          case 'fs_rename':
            fsOps.push({ op: 'rename', path: args.oldPath as string, newName: args.newName as string });
            return undefined;
          case 'fs_delete':
            fsOps.push({ op: 'delete', path: args.path as string });
            return undefined;
          case 'ssh_rename':
            sshOps.push({ op: 'rename', path: args.path as string, newName: args.newName as string });
            return undefined;
          case 'ssh_delete':
            sshOps.push({ op: 'delete', path: args.path as string });
            return undefined;
          case 'plugin:event|listen':
            eventListeners.set(args.event as string, args.handler as number);
            return 0;
          case 'plugin:event|unlisten':
            return undefined;
          default:
            return null;
        }
      },
      // 测试可直接注入任意 PTY 输出字节（如 altScreen 序列）
      emitPtyOutput: (data: string) => {
        emitOutput(data);
      },
    };
    localStorage.setItem('vrykell-api-key', 'sk-e2e-fake');
  }, { enableIntegration: integration, models: seedModels, active: seedActive, skillsSeed: seedSkills });
}

/** 预置 AI 回复文本：mock 的 ai_stream 会按 chunk 流式 emit ai-chunk 事件。
 *  AI 流式已下沉 Rust（invoke ai_stream + ai-chunk 事件），不再走浏览器 HTTP。 */
export async function mockAnthropic(page: Page, replyText: string) {
  await page.addInitScript((text: string) => {
    (window as unknown as Record<string, string>).__AI_REPLY__ = text;
  }, replyText);
}

/** 读取假 PTY 收到的全部写入 */
export function ptyWrites(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as Record<string, string[]>).__PTY_WRITES__);
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

/** 读取远程文件面板调用的 ssh_rename / ssh_delete 记录 */
export function sshOps(page: Page): Promise<{ op: string; path: string; newName?: string }[]> {
  return page.evaluate(() => (window as unknown as Record<string, { op: string; path: string; newName?: string }[]>).__SSH_OPS__);
}

/** 读取下载管理里「定位」调用的 reveal 路径记录 */
export function revealedPaths(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as Record<string, string[]>).__REVEALED__);
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
