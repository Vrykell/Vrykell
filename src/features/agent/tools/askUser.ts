import { tool } from 'ai';
import { z } from 'zod';
import type { ToolContext } from '../stores/permissions';
import { questionKey, requestUserAnswer } from '../services/userQuestions';
import { t } from '@i18n';

export function buildAskUserTool(ctx: ToolContext) {
  let asked = false;
  return tool({
    description: 'Ask at most one focused question per turn for missing information or a decision. Wait for the answer and use it to continue. Offer up to six concise options; free-text answers are always allowed. Never request execution permission here or repeat an answered, skipped or cancelled question, even rephrased. Do not ask whether to start work the user already requested; execution approval uses the authorization interface.',
    inputSchema: z.object({ question: z.string().trim().min(1).max(2000), options: z.array(z.string().trim().min(1).max(200)).max(6).optional() }),
    execute: async (input, { toolCallId, abortSignal }) => {
      if (!ctx.tabId || !ctx.setToolState) return { ok: false, answered: false, error: t('This context cannot ask the user a question.') };
      if (asked) return { ok: false, answered: false, error: t('A question was already asked in this turn. Use its answer and finish without asking again.') };
      asked = true;
      const pending = requestUserAnswer(questionKey(ctx.tabId, toolCallId), { ...input, options: input.options ? [...new Set(input.options)] : undefined }, abortSignal ?? ctx.signal);
      ctx.setToolState(toolCallId, 'input-pending');
      return pending;
    },
  });
}
