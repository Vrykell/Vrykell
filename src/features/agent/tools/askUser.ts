import { tool } from 'ai';
import { z } from 'zod';
import type { ToolContext } from '../stores/permissions';
import { questionKey, requestUserAnswer } from '../services/userQuestions';
import { t } from '@i18n';

export function buildAskUserTool(ctx: ToolContext) {
  return tool({
    description: 'Ask the user one focused question and wait for their answer before continuing. Offer up to six concise options when useful; free-text answers are always allowed. Use this for missing information or decisions, not to grant execution permissions. Never repeat a skipped or cancelled question automatically.',
    inputSchema: z.object({ question: z.string().trim().min(1).max(2000), options: z.array(z.string().trim().min(1).max(200)).max(6).optional() }),
    execute: async (input, { toolCallId, abortSignal }) => {
      if (!ctx.tabId || !ctx.setToolState) return { ok: false, answered: false, error: t('This context cannot ask the user a question.') };
      const pending = requestUserAnswer(questionKey(ctx.tabId, toolCallId), { ...input, options: input.options ? [...new Set(input.options)] : undefined }, abortSignal ?? ctx.signal);
      ctx.setToolState(toolCallId, 'input-pending');
      return pending;
    },
  });
}
