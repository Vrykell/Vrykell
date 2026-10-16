/**
 * brandMarks — the vendor marks that identify the services a model list points at.
 *
 * The marks come from `@lobehub/icons` (MIT, the AI/LLM brand icon collection) in its monochrome
 * variant: `currentColor` fill in the same 24-unit box the rest of the icon set uses, so callers
 * decide the hue — a `--brand-*` theme token where the palette defines one, neutral ink otherwise.
 * Each brand is imported from its `components/Mono` module; the `.js` suffix matches the package's
 * `es/<brand>.js` export pattern (its plain per-brand `Mono` entry points at files not shipped).
 * Only the marks in use reach the bundle.
 */
import Anthropic from '@lobehub/icons/es/Anthropic/components/Mono.js';
import DeepSeek from '@lobehub/icons/es/DeepSeek/components/Mono.js';
import Gemini from '@lobehub/icons/es/Gemini/components/Mono.js';
import Groq from '@lobehub/icons/es/Groq/components/Mono.js';
import Mistral from '@lobehub/icons/es/Mistral/components/Mono.js';
import Moonshot from '@lobehub/icons/es/Moonshot/components/Mono.js';
import Ollama from '@lobehub/icons/es/Ollama/components/Mono.js';
import OpenAI from '@lobehub/icons/es/OpenAI/components/Mono.js';
import OpenRouter from '@lobehub/icons/es/OpenRouter/components/Mono.js';
import Qwen from '@lobehub/icons/es/Qwen/components/Mono.js';
import SiliconCloud from '@lobehub/icons/es/SiliconCloud/components/Mono.js';
import XAI from '@lobehub/icons/es/XAI/components/Mono.js';
import Zhipu from '@lobehub/icons/es/Zhipu/components/Mono.js';
import type { AppIcon } from './icons';

/** The library sizes and colours like our own icons, so one cast keeps a single icon contract. */
export const AnthropicMark = Anthropic as unknown as AppIcon;
export const OpenAIMark = OpenAI as unknown as AppIcon;
export const GeminiMark = Gemini as unknown as AppIcon;
export const DeepSeekMark = DeepSeek as unknown as AppIcon;
export const MoonshotMark = Moonshot as unknown as AppIcon;
export const ZhipuMark = Zhipu as unknown as AppIcon;
export const QwenMark = Qwen as unknown as AppIcon;
export const SiliconFlowMark = SiliconCloud as unknown as AppIcon;
export const OpenRouterMark = OpenRouter as unknown as AppIcon;
export const GroqMark = Groq as unknown as AppIcon;
export const XaiMark = XAI as unknown as AppIcon;
export const MistralMark = Mistral as unknown as AppIcon;
export const OllamaMark = Ollama as unknown as AppIcon;
