/**
 * brandMarks — the vendor marks that identify the services a model list points at.
 *
 * The marks come from `@lobehub/icons` (MIT, the AI/LLM brand icon collection): the coloured
 * variant where the collection ships one and the monochrome variant otherwise, both in the same
 * 24-unit box the rest of the icon set uses. A monochrome mark draws in `currentColor`, so its
 * caller decides the hue; a coloured one keeps the brand's own palette. Each brand is imported
 * from its `components/*` module; the `.js` suffix matches the package's `es/<brand>.js` export
 * pattern (its plain per-brand entry points at files not shipped). Only the marks in use reach
 * the bundle.
 */
import AnthropicMono from '@lobehub/icons/es/Anthropic/components/Mono.js';
import DeepSeekColor from '@lobehub/icons/es/DeepSeek/components/Color.js';
import GeminiColor from '@lobehub/icons/es/Gemini/components/Color.js';
import GroqMono from '@lobehub/icons/es/Groq/components/Mono.js';
import MistralColor from '@lobehub/icons/es/Mistral/components/Color.js';
import MoonshotMono from '@lobehub/icons/es/Moonshot/components/Mono.js';
import OllamaMono from '@lobehub/icons/es/Ollama/components/Mono.js';
import OpenAIMono from '@lobehub/icons/es/OpenAI/components/Mono.js';
import OpenRouterColor from '@lobehub/icons/es/OpenRouter/components/Color.js';
import QwenColor from '@lobehub/icons/es/Qwen/components/Color.js';
import SiliconCloudColor from '@lobehub/icons/es/SiliconCloud/components/Color.js';
import XAIMono from '@lobehub/icons/es/XAI/components/Mono.js';
import ZhipuColor from '@lobehub/icons/es/Zhipu/components/Color.js';
import type { AppIcon } from './icons';

export const AnthropicMark = AnthropicMono as unknown as AppIcon;
export const OpenAIMark = OpenAIMono as unknown as AppIcon;
export const GeminiMark = GeminiColor as unknown as AppIcon;
export const DeepSeekMark = DeepSeekColor as unknown as AppIcon;
export const MoonshotMark = MoonshotMono as unknown as AppIcon;
export const ZhipuMark = ZhipuColor as unknown as AppIcon;
export const QwenMark = QwenColor as unknown as AppIcon;
export const SiliconFlowMark = SiliconCloudColor as unknown as AppIcon;
export const OpenRouterMark = OpenRouterColor as unknown as AppIcon;
export const GroqMark = GroqMono as unknown as AppIcon;
export const XaiMark = XAIMono as unknown as AppIcon;
export const MistralMark = MistralColor as unknown as AppIcon;
export const OllamaMark = OllamaMono as unknown as AppIcon;
