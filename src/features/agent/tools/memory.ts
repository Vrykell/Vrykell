/**
 * memory — 长期记忆工具（FACT + JOURNAL）：
 *   read=读取全部记忆；update=重写持久知识（记忆整理）；
 *   append=追加一条流水；search=按关键词搜索。
 */
import { tool } from 'ai';
import { DESC_MEMORY } from '../toolTexts';
import { z } from 'zod';
import { getMemory, setMemory, getMemoryJournal, appendMemoryJournal } from '../platform';
import { gate, type ToolContext } from '../permissions';

export function buildMemoryTool(ctx: ToolContext) {
  return {
    memory: tool({
      description: DESC_MEMORY,
      inputSchema: z.object({
        action: z.enum(['read', 'update', 'append', 'search']),
        content: z.string().optional().describe('update 时的完整 FACT 内容'),
        text: z.string().optional().describe('append 时的流水文本'),
        query: z.string().optional().describe('search 时的关键词'),
        limit: z.number().int().min(1).max(50).optional().describe('search 返回条数，默认 10'),
      }),
      execute: async (args, { toolCallId }) => {
        const g = await gate('memory', { action: args.action }, toolCallId, ctx);
        if (!g.proceed) return g.result;
        try {
          switch (args.action) {
            case 'read': {
              const fact = await getMemory();
              const journal = await getMemoryJournal();
              return `【持久知识】\n${fact || '（空）'}\n\n【流水】\n${journal || '（空）'}`;
            }
            case 'update': {
              if (!args.content) return { ok: false, error: 'update 需要 content' };
              await setMemory(args.content);
              return { ok: true, result: '已重写持久知识' };
            }
            case 'append': {
              if (!args.text?.trim()) return { ok: false, error: 'append 需要 text' };
              await appendMemoryJournal(args.text);
              return { ok: true, result: '已追加流水' };
            }
            case 'search': {
              const q = (args.query ?? '').toLowerCase();
              const fact = await getMemory();
              const journal = await getMemoryJournal();
              const hits: string[] = [];
              for (const line of fact.split('\n')) {
                if (!q || line.toLowerCase().includes(q)) hits.push(`FACT: ${line}`);
              }
              for (const line of journal.split('\n')) {
                if (!q || line.toLowerCase().includes(q)) hits.push(line);
              }
              const lim = args.limit ?? 10;
              return hits.slice(-lim).join('\n') || '（无匹配）';
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
