/**
 * agentStream — chat store StreamFn 的 AI SDK 实现。
 *
 * M1 fullStream 路径：streamText + stepCountIs(8) + run_command 工具。
 * 文本 delta 走 onChunk（chat store 50ms 合批）；工具事件低频直写
 * ctx.handlers.onToolEvent（upsert ToolRun，渲染为 rail 上的节点卡片）。
 * agentMode 关闭时 tools=undefined，行为等价 M0 纯文本路径。
 * 网络层走 createChatModel 注入的 Rust 代理 fetch（key 不出 Rust）。
 */
import { describeError } from '@features/agent/model/agentErrors';
import { stepCountIs, streamText, type ModelMessage, type ToolSet } from 'ai';
import { invoke } from '@tauri-apps/api/core';
import type { StreamFn } from '@features/chat';
import { createChatModel, createNativeWebSearchTool, deepThinkProviderOptions, type ProviderKind } from '@features/agent/services/provider';
import { useAgentSettings } from '@features/agent/stores/agentSettings';
import { estimateTokens, planContext, IMAGE_TOKEN_ESTIMATE, type SizedMessage } from '@features/agent/model/context';
import { attachmentsForModel, supportsVision } from '@features/agent/model/attachments';
import { buildTools } from '@features/agent/tools';
import { buildTavilySearchTool } from '@features/agent/tools/webSearch';
import { buildWebSearchTool, buildWebFetchTool, buildWebCrawlTool } from '@features/agent/tools/webFetch';
import { buildSystemPrompt } from '@features/agent/model/systemPrompt';
import { listSkills, buildSkillsContext, availableSkillMetas } from '@features/agent/services/skills';
import { getMemory, getMemoryJournal, listAgents } from '@features/agent/services/platform';
import { listMcpTools, buildMcpTool } from '@features/agent/services/mcp';
import { levelOf, type ToolContext } from '@features/agent/stores/permissions';
import type { ToolRunState } from '@features/agent/model/messageParts';

interface AiConfigInfoRust {
  has_key: boolean;
  base_url: string;
  model: string;
  provider: ProviderKind;
  has_anthropic_key: boolean;
  has_gemini_key: boolean;
  has_tavily_key: boolean;
  models: {
    id: string; name: string; provider: ProviderKind; baseUrl: string; model: string;
    capabilities?: { vision: boolean; reasoning: boolean; tools: boolean; search: boolean };
  }[];
  active_model: string;
}

function hasKeyFor(info: AiConfigInfoRust): boolean {
  switch (info.provider) {
    case 'anthropic':
      return info.has_anthropic_key;
    case 'gemini':
      return info.has_gemini_key;
    default:
      return info.has_key;
  }
}

export const agentStream: StreamFn = async (messages, onChunk, ctx) => {
  const info = await invoke<AiConfigInfoRust>('get_ai_config');
  if (!hasKeyFor(info)) {
    throw new Error('尚未配置 API Key，请先在设置中填入');
  }
  const model = createChatModel({
    provider: info.provider,
    baseUrl: info.base_url,
    model: info.model,
  });
  const settings = useAgentSettings.getState().resolve(info.active_model);
  const agentMode = settings.agentMode;
  const emitTool = ctx?.handlers?.onToolEvent;
  const emitReasoning = ctx?.handlers?.onReasoning;

  // M5 附件：带附件的用户消息展开为多模态 ModelMessage（文本段 + 图片 part），
  // 非视觉模型的图片在 attachmentsForModel 内降级为占位提示文本。
  // 视觉能力优先取模型探测结果（创建时自动探测），旧数据按名字启发式兜底。
  const vision =
    (info.models ?? []).find((m) => m.id === info.active_model)?.capabilities?.vision ??
    supportsVision(info.provider, info.model);
  const sized: SizedMessage[] = [];
  for (const m of messages) {
    if (m.attachments?.length) {
      const { text, images } = await attachmentsForModel(m.attachments, vision);
      const content = [m.content, text].filter(Boolean).join('\n\n');
      if (images.length > 0) {
        const msg: ModelMessage = {
          role: 'user',
          content: [
            ...(content ? [{ type: 'text' as const, text: content }] : []),
            ...images.map((image) => ({ type: 'image' as const, image })),
          ],
        };
        sized.push({ msg, tokens: estimateTokens(content) + images.length * IMAGE_TOKEN_ESTIMATE });
      } else {
        sized.push({ msg: { role: m.role as 'user' | 'assistant', content }, tokens: estimateTokens(content) });
      }
    } else {
      sized.push({ msg: m as ModelMessage, tokens: estimateTokens(m.content) });
    }
  }

  // code-agent 式上下文管理：按 token 预算窗口裁剪，compact 策略下把溢出旧消息压缩成摘要
  const plan = await planContext({
    sized,
    strategy: settings.contextStrategy,
    maxTokens: settings.contextMaxTokens,
    summaryTokens: settings.contextSummaryTokens,
    model,
    tabId: ctx?.tabId,
    signal: ctx?.signal,
  });
  // 系统提示词：自定义（设置里）优先，否则内置默认；压缩摘要（compact）作为运行上下文追加。
  // AI SDK v7 默认 allowSystemInMessages=false：system 必须走 instructions 选项，
  // 不能塞进 messages（否则 provider 校验直接抛 InvalidPromptError）。
  let skillsContext = '';
  try {
    skillsContext = buildSkillsContext(availableSkillMetas(await listSkills()));
  } catch {
    /* 技能目录未就绪或扫描失败：跳过技能清单 */
  }
  let memoryContext = '';
  try {
    const [fact, journal] = await Promise.all([getMemory(), getMemoryJournal()]);
    const parts: string[] = [];
    if (fact.trim()) parts.push(`持久知识：\n${fact}`);
    const jlines = journal.split('\n').filter(Boolean).slice(-15);
    if (jlines.length) parts.push(`近期流水：\n${jlines.join('\n')}`);
    if (parts.length) memoryContext = `长期记忆：\n${parts.join('\n\n')}`;
  } catch {
    /* 记忆读取失败：跳过 */
  }
  let agentsContext = '';
  try {
    const agents = await listAgents();
    if (agents.length) {
      agentsContext =
        '子代理（用 spawn_agent 工具按名委派任务）：\n' +
        agents.map((a) => `- ${a.name}：${a.description || '无描述'}`).join('\n');
    }
  } catch {
    /* 子代理读取失败：跳过 */
  }
  const systemPrompt = [
    buildSystemPrompt(settings.systemPrompt, plan.system),
    memoryContext,
    skillsContext,
    agentsContext,
  ]
    .filter(Boolean)
    .join('\n\n');
  // 上下文占用上报：压缩后 kept 变小 → 圆环自动减小
  if (ctx?.handlers?.onContextUsed) {
    let used = 0;
    for (const m of plan.messages) {
      used += estimateTokens(typeof m.content === 'string' ? m.content : '');
    }
    if (systemPrompt) used += estimateTokens(systemPrompt);
    ctx.handlers.onContextUsed(used, settings.contextMaxTokens > 0 ? settings.contextMaxTokens : 0);
  }
  const modelMessages: ModelMessage[] = plan.messages;

  // 工具调用账本：tool-result/tool-error 事件重建完整 ToolRun 需要
  // toolName/input/startedAt（result 部分不一定带回 input）
  const calls = new Map<
    string,
    { toolName: string; input: Record<string, unknown>; startedAt: number }
  >();

  // 工具表：M1-M3 的本地工具 + M6 联网搜索。
  // 联网优先级：provider 原生（anthropic web_search / gemini google_search，
  // 服务端执行）→ openai-compatible 用 Tavily 转发兜底。
  // 权限只到「注册/不注册」一级：原生工具无本地 execute，per-call 审批不适用。
  // M3 审批状态回写：gate() 在 ask/决定时把 ToolRun 打到
  // approval-pending / running / denied（含危险命令原因）。本地工具与 MCP 工具共用。
  const toolContext: ToolContext = {
    signal: ctx?.signal,
    tabId: ctx?.tabId,
    setToolState: (toolCallId, state: ToolRunState, extra) => {
      const c = calls.get(toolCallId);
      emitTool?.({
        toolCallId,
        toolName: c?.toolName ?? 'unknown',
        input: c?.input ?? {},
        startedAt: c?.startedAt ?? Date.now(),
        state,
        ...(extra?.danger ? { danger: extra.danger } : {}),
      });
    },
  };
  const tools: ToolSet = agentMode ? buildTools(toolContext) : {};
  // web_search：一等工具，与 web_fetch/web_crawl 同级，无需任何配置即可用。
  // 优先级：provider 原生 → Tavily（配了 key）→ DuckDuckGo HTML 抓取（无 key 兜底）。
  if (agentMode && levelOf('web_search') !== 'deny') {
    const native = createNativeWebSearchTool(info.provider);
    if (native) {
      tools[native.name] = native.tool;
    } else if (info.has_tavily_key) {
      tools.web_search = buildTavilySearchTool({ signal: ctx?.signal, tabId: ctx?.tabId });
    } else {
      tools.web_search = buildWebSearchTool({ signal: ctx?.signal, tabId: ctx?.tabId });
    }
  }
  // webfetch / web_crawl：一等工具，与 read_file/edit_file 同级 —— 只要 agent 模式
  // 且未被 deny 就注册（不依赖「联网搜索」开关；开关只控制上面的 web_search）。
  if (agentMode && levelOf('web_fetch') !== 'deny') {
    tools.web_fetch = buildWebFetchTool({ signal: ctx?.signal, tabId: ctx?.tabId });
  }
  if (agentMode && levelOf('web_crawl') !== 'deny') {
    tools.web_crawl = buildWebCrawlTool({ signal: ctx?.signal, tabId: ctx?.tabId });
  }
  // MCP：把已连接服务器暴露的工具包装成 `mcp__<server>__<tool>`。连接失败/无服务器时静默跳过。
  if (agentMode && levelOf('mcp') !== 'deny') {
    try {
      const mcpTools = await listMcpTools();
      for (const mt of mcpTools) {
        tools[`mcp__${mt.server}__${mt.name}`] = buildMcpTool(mt, toolContext);
      }
    } catch (e) {
      console.warn('[agentStream] 获取 MCP 工具失败（可能无已连接服务器）:', e);
    }
  }
  const hasTools = Object.keys(tools).length > 0;

  // AI SDK v7 的流不 reject：错误走 onError 回调 + fullStream 的 error part，
  // 迭代静默结束。这里捕获后重抛，维持 chat store「catch → 显示出错了」的行为。
  let streamError: unknown = null;
  const result = streamText({
    model,
    messages: modelMessages,
    instructions: systemPrompt || undefined,
    tools: hasTools ? tools : undefined,
    stopWhen: hasTools ? stepCountIs(Math.max(1, Math.round(settings.maxSteps))) : undefined,
    abortSignal: ctx?.signal,
    // M6 深思考：providerOptions 透传（openai-compatible → reasoning_effort）。
    // anthropic thinking 要求 maxOutputTokens > budgetTokens(8000)。
    providerOptions: settings.deepThink ? deepThinkProviderOptions(info.provider, settings.thinkingLevel) : undefined,
    maxOutputTokens:
      settings.maxOutputTokens > 0
        ? settings.maxOutputTokens
        : settings.deepThink && info.provider === 'anthropic'
          ? (settings.thinkingLevel === 'low' ? 8000 : settings.thinkingLevel === 'medium' ? 16000 : 32000)
          : undefined,
    temperature: settings.temperature != null ? settings.temperature : undefined,
    onError: ({ error }) => {
      streamError = error;
    },
  });
  // 步数上限检测：记录完成步数与最后一步 finishReason，用于在静默截断时标明原因
  const stepLimit = hasTools ? Math.max(1, Math.round(settings.maxSteps)) : 0;
  let stepCount = 0;
  let lastFinishReason: string | undefined;

  for await (const part of result.fullStream) {
    switch (part.type) {
      case 'text-delta': {
        // v7 为 part.text；防御性兼容旧的 textDelta 命名
        const t =
          (part as { text?: string }).text ?? (part as { textDelta?: string }).textDelta ?? '';
        if (t) onChunk(t);
        break;
      }
      case 'reasoning-delta': {
        const t = (part as { text?: string }).text ?? '';
        if (t) emitReasoning?.(t);
        break;
      }
      case 'finish-step': {
        stepCount += 1;
        lastFinishReason = (part as { finishReason?: string }).finishReason;
        break;
      }
      case 'tool-call': {
        const p = part as {
          toolCallId: string;
          toolName: string;
          input?: unknown;
        };
        const input = (p.input ?? {}) as Record<string, unknown>;
        const startedAt = Date.now();
        calls.set(p.toolCallId, { toolName: p.toolName, input, startedAt });
        emitTool?.({
          toolCallId: p.toolCallId,
          toolName: p.toolName,
          input,
          state: 'running',
          startedAt,
        });
        break;
      }
      case 'tool-result': {
        const p = part as { toolCallId: string; toolName?: string; output?: unknown; result?: unknown };
        const c = calls.get(p.toolCallId);
        const raw = p.output ?? p.result;
        const out = typeof raw === 'string' ? raw : JSON.stringify(raw);
        // 结构化结果哨兵：denied → 保持灰环（不盖成绿）；ok:false → 红节点
        let state: 'done' | 'error' | 'denied' = 'done';
        let error: string | undefined;
        try {
          const v: unknown = JSON.parse(out);
          if (v && typeof v === 'object') {
            const o = v as { denied?: unknown; ok?: unknown; error?: unknown };
            if (o.denied === true) state = 'denied';
            else if (o.ok === false) {
              state = 'error';
              error = typeof o.error === 'string' ? o.error : undefined;
            }
          }
        } catch {
          /* 非 JSON 输出原样按 done 处理 */
        }
        emitTool?.({
          toolCallId: p.toolCallId,
          toolName: c?.toolName ?? p.toolName ?? 'unknown',
          input: c?.input ?? {},
          state,
          output: out.length > settings.contextToolChars ? out.slice(0, settings.contextToolChars) : out,
          error,
          startedAt: c?.startedAt ?? Date.now(),
          endedAt: Date.now(),
        });
        break;
      }
      case 'tool-error': {
        const p = part as { toolCallId: string; toolName?: string; error?: unknown };
        const c = calls.get(p.toolCallId);
        emitTool?.({
          toolCallId: p.toolCallId,
          toolName: c?.toolName ?? p.toolName ?? 'unknown',
          input: c?.input ?? {},
          state: 'error',
          error: describeError(p.error),
          startedAt: c?.startedAt ?? Date.now(),
          endedAt: Date.now(),
        });
        break;
      }
      case 'error': {
        streamError = (part as { error?: unknown }).error;
        break;
      }
      default:
        break; // start/end/finish 等事件暂不消费
    }
  }
  // 达到工具调用上限：streamText 会静默截断（无 finishReason），此处补上失败原因
  if (streamError == null && stepLimit > 0 && stepCount >= stepLimit && lastFinishReason === 'tool-calls') {
    onChunk(
      `\n\n> ⚠️ 已达工具调用上限（${stepLimit} 步），回复可能不完整；可在「AI 行为」页调高最大迭代步数。`,
    );
  }
  if (streamError != null) {
    console.error('[agentStream] 流式请求失败:', streamError);
    throw new Error(describeError(streamError));
  }
};
