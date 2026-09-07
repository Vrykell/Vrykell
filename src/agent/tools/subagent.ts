/**
 * subagent — 子代理工具：spawn/create/list/remove，让 LLM 自己调度与扩展子代理。
 */

import { invoke } from '@tauri-apps/api/core';
import { generateText, tool } from 'ai';
import { z } from 'zod';
import { gate, type ToolContext } from '@/agent/permissions';
import { getAgent, listAgents, removeAgent, saveAgent } from '@/agent/platform';
import { createChatModel, type ProviderKind } from '@/agent/provider';
import { DESC_SUBAGENT } from '@/agent/toolTexts';

interface AiConfigRust {
  base_url: string;
  model: string;
  provider: ProviderKind;
}

export function buildSubagentTool(ctx: ToolContext) {
  return {
    subagent: tool({
      description: DESC_SUBAGENT,
      inputSchema: z.object({
        action: z.enum(['spawn', 'create', 'list', 'remove']),
        agent: z.string().optional().describe('子代理名（spawn/remove 用）'),
        task: z.string().optional().describe('spawn 时的任务'),
        name: z.string().optional().describe('create 时的名称'),
        description: z.string().optional().describe('create 时的一句话描述'),
        prompt: z.string().optional().describe('create 时的系统提示词'),
      }),
      execute: async (args, { toolCallId, abortSignal }) => {
        const g = await gate('subagent', { action: args.action }, toolCallId, ctx);
        if (!g.proceed) return g.result;
        try {
          switch (args.action) {
            case 'list': {
              const list = await listAgents();
              if (!list.length) return '（无子代理）';
              return list.map((a) => `- ${a.name}：${a.description || '无描述'}`).join('\n');
            }
            case 'create': {
              if (!args.name?.trim() || !args.prompt?.trim())
                return { ok: false, error: 'create 需要 name 与 prompt' };
              await saveAgent({
                id: '',
                name: args.name.trim(),
                description: args.description ?? '',
                prompt: args.prompt,
              });
              return { ok: true, result: `已创建子代理「${args.name.trim()}」` };
            }
            case 'remove': {
              const list = await listAgents();
              const a = list.find((x) => x.name === args.agent || x.id === args.agent);
              if (!a) return { ok: false, error: '未找到子代理（用 list 查）' };
              await removeAgent(a.id);
              return { ok: true, result: `已删除「${a.name}」` };
            }
            case 'spawn': {
              if (!args.agent || !args.task?.trim())
                return { ok: false, error: 'spawn 需要 agent 与 task' };
              const def = await getAgent(args.agent);
              const info = await invoke<AiConfigRust>('get_ai_config');
              const model = createChatModel({
                provider: info.provider,
                baseUrl: info.base_url,
                model: info.model,
              });
              const { text } = await generateText({
                model,
                system: def.prompt,
                prompt: args.task,
                abortSignal: abortSignal ?? ctx.signal,
              });
              return text || '（子代理未返回内容）';
            }
            default:
              return { ok: false, error: '未知 action' };
          }
        } catch (e) {
          return { ok: false, error: String((e as Error)?.message ?? e) };
        }
      },
    }),
  };
}
