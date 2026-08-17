import type { Page } from '@playwright/test';

export interface TauriMockOptions {
  /** 是否启用 OSC 133 shell integration（默认 true）。
   *  false 时 mock 保持 classic 场景，用于测试无 integration 回退。 */
  integration?: boolean;
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
  await page.addInitScript((enableIntegration) => {
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
      hasKey: false,
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    };
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
    (window as unknown as Record<string, unknown>).__PTY_WRITES__ = writes;
    (window as unknown as Record<string, unknown>).__PTY_SIGNALS__ = signals;
    (window as unknown as Record<string, unknown>).__PTY_RESIZES__ = resizes;
    (window as unknown as Record<string, unknown>).__FS_OPS__ = fsOps;
    (window as unknown as Record<string, unknown>).__SSH_OPS__ = sshOps;
    (window as unknown as Record<string, unknown>).__DOWNLOADS__ = downloads;
    (window as unknown as Record<string, unknown>).__REVEALED__ = revealed;
    (window as unknown as Record<string, unknown>).__SESSION_PAYLOADS__ = sessionPayloads;

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
          case 'get_ai_config':
            return { has_key: aiConfig.hasKey, base_url: aiConfig.baseUrl, model: aiConfig.model };
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
          case 'ssh_list':
            return [
              { name: 'Documents', path: '/home/root/Documents', is_dir: true },
              { name: 'app.log', path: '/home/root/app.log', is_dir: false },
            ];
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
    localStorage.setItem('ai-terminal-api-key', 'sk-e2e-fake');
  }, integration);
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
