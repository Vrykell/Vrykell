import { generateText, type ModelMessage } from 'ai';
import { t } from '@i18n';
import { diagnostic } from '@platform/diagnostics';
import { activeModelProfile } from '../stores/aiConfig';
import { createChatModel } from './provider';

/** Extract one complete object without inventing missing JSON or accepting a partial result. */
export function parseGeneratedObject(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) throw new SyntaxError('Missing JSON object');
  let depth = 0; let quoted = false; let escaped = false;
  for (let index = start; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '{') depth++;
    else if (character === '}' && --depth === 0) return JSON.parse(text.slice(start, index + 1)) as unknown;
  }
  throw new SyntaxError('Incomplete JSON object');
}

/** Retry invalid or truncated structured replies once; diagnostics contain metadata only. */
export async function generateStructured<T>({ system, messages, prompt, signal, task, parse }: {
  system: string; signal: AbortSignal; task: 'grouping' | 'command'; parse: (text: string) => T;
} & ({ prompt: string; messages?: never } | { messages: ModelMessage[]; prompt?: never })): Promise<T> {
  let failure: 'empty' | 'length' | 'invalid' = 'invalid';
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    let result: Awaited<ReturnType<typeof generateText>>;
    try { result = await generateText({
      model: createChatModel(activeModelProfile()), abortSignal: signal, maxRetries: 0,
      maxOutputTokens: attempt ? 16384 : 8192,
      system: `${system}\nReturn one complete compact JSON object. Do not include reasoning, commentary or Markdown fences.${attempt ? '\nThe previous reply was empty, incomplete or invalid. Generate the complete result again and check every required field.' : ''}`,
      ...(messages ? { messages } : { prompt }),
    }); } catch (error) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (!(error instanceof SyntaxError) && !(error instanceof Error && /JSONParseError|NoOutputGeneratedError/.test(error.name))) throw error;
      failure = 'invalid';
      diagnostic('ai-structured-retry', { task, attempt: attempt + 1, failure: 'transport-json', retrying: attempt === 0 }, 'warn');
      continue;
    }
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    diagnostic('ai-structured-result', { task, attempt: attempt + 1, finishReason: result.finishReason,
      textLength: result.text.length, outputTokens: result.usage?.outputTokens });
    try { return parse(result.text); }
    catch {
      failure = result.finishReason === 'length' ? 'length' : result.text.trim() ? 'invalid' : 'empty';
      diagnostic('ai-structured-retry', { task, attempt: attempt + 1, failure, retrying: attempt === 0 }, 'warn');
    }
  }
  throw new Error(t(failure === 'length' ? 'The AI response was cut off. Try fewer items or another model.'
    : failure === 'empty' ? 'The model returned no result. Try again or choose another model.'
      : 'The model returned an invalid result after retrying. Try again or choose another model.'));
}
