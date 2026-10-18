/**
 * brandMarks — the vendor marks that identify the services a model list points at.
 *
 * The marks come from `@lobehub/icons` (MIT, the AI/LLM brand icon collection): the coloured
 * variant where the collection ships one and the monochrome variant otherwise, both in the same
 * 24-unit box the rest of the icon set uses. The avatar constants come from the same per-brand
 * style module and paint the disc the model rows put behind the monochrome mark (a brand-coloured
 * circle with the collection's own ink), so a row reads as the real service wherever one is
 * recognisable. Each brand is imported from its `components/*` module; the `.js` suffix matches
 * the package's `es/<brand>.js` export pattern (its plain per-brand entry points at files not
 * shipped). Only the marks in use reach the bundle.
 */
import AnthropicMono from '@lobehub/icons/es/Anthropic/components/Mono.js';
import { AVATAR_BACKGROUND as anthropicBg, AVATAR_COLOR as anthropicInk } from '@lobehub/icons/es/Anthropic/style';
import DeepSeekColor from '@lobehub/icons/es/DeepSeek/components/Color.js';
import DeepSeekMono from '@lobehub/icons/es/DeepSeek/components/Mono.js';
import { AVATAR_BACKGROUND as deepseekBg, AVATAR_COLOR as deepseekInk } from '@lobehub/icons/es/DeepSeek/style';
import GeminiColor from '@lobehub/icons/es/Gemini/components/Color.js';
import GeminiMono from '@lobehub/icons/es/Gemini/components/Mono.js';
import { AVATAR_BACKGROUND as geminiBg, AVATAR_COLOR as geminiInk } from '@lobehub/icons/es/Gemini/style';
import GroqMono from '@lobehub/icons/es/Groq/components/Mono.js';
import { AVATAR_BACKGROUND as groqBg, AVATAR_COLOR as groqInk } from '@lobehub/icons/es/Groq/style';
import MistralColor from '@lobehub/icons/es/Mistral/components/Color.js';
import MistralMono from '@lobehub/icons/es/Mistral/components/Mono.js';
import { AVATAR_BACKGROUND as mistralBg, AVATAR_COLOR as mistralInk } from '@lobehub/icons/es/Mistral/style';
import MoonshotMono from '@lobehub/icons/es/Moonshot/components/Mono.js';
import { AVATAR_BACKGROUND as moonshotBg, AVATAR_COLOR as moonshotInk } from '@lobehub/icons/es/Moonshot/style';
import OllamaMono from '@lobehub/icons/es/Ollama/components/Mono.js';
import { AVATAR_BACKGROUND as ollamaBg, AVATAR_COLOR as ollamaInk } from '@lobehub/icons/es/Ollama/style';
import OpenAIMono from '@lobehub/icons/es/OpenAI/components/Mono.js';
import { AVATAR_BACKGROUND as openaiBg, AVATAR_COLOR as openaiInk } from '@lobehub/icons/es/OpenAI/style';
import OpenRouterColor from '@lobehub/icons/es/OpenRouter/components/Color.js';
import OpenRouterMono from '@lobehub/icons/es/OpenRouter/components/Mono.js';
import { AVATAR_BACKGROUND as openrouterBg, AVATAR_COLOR as openrouterInk } from '@lobehub/icons/es/OpenRouter/style';
import QwenColor from '@lobehub/icons/es/Qwen/components/Color.js';
import QwenMono from '@lobehub/icons/es/Qwen/components/Mono.js';
import { AVATAR_BACKGROUND as qwenBg, AVATAR_COLOR as qwenInk } from '@lobehub/icons/es/Qwen/style';
import SiliconCloudColor from '@lobehub/icons/es/SiliconCloud/components/Color.js';
import SiliconCloudMono from '@lobehub/icons/es/SiliconCloud/components/Mono.js';
import { AVATAR_BACKGROUND as siliconflowBg, AVATAR_COLOR as siliconflowInk } from '@lobehub/icons/es/SiliconCloud/style';
import XAIMono from '@lobehub/icons/es/XAI/components/Mono.js';
import { AVATAR_BACKGROUND as xaiBg, AVATAR_COLOR as xaiInk } from '@lobehub/icons/es/XAI/style';
import ZhipuColor from '@lobehub/icons/es/Zhipu/components/Color.js';
import ZhipuMono from '@lobehub/icons/es/Zhipu/components/Mono.js';
import { AVATAR_BACKGROUND as zhipuBg, AVATAR_COLOR as zhipuInk } from '@lobehub/icons/es/Zhipu/style';
import type { AppIcon } from './icons';

/** Marks that stand on their own (chips, pickers): the coloured variant where one exists. */
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

/** The monochrome mark per vendor id, for tiles that paint their own background. */
export const MONO_MARKS: Record<string, AppIcon> = {
  anthropic: AnthropicMono as unknown as AppIcon,
  openai: OpenAIMono as unknown as AppIcon,
  gemini: GeminiMono as unknown as AppIcon,
  deepseek: DeepSeekMono as unknown as AppIcon,
  moonshot: MoonshotMono as unknown as AppIcon,
  zhipu: ZhipuMono as unknown as AppIcon,
  qwen: QwenMono as unknown as AppIcon,
  siliconflow: SiliconCloudMono as unknown as AppIcon,
  openrouter: OpenRouterMono as unknown as AppIcon,
  groq: GroqMono as unknown as AppIcon,
  xai: XAIMono as unknown as AppIcon,
  mistral: MistralMono as unknown as AppIcon,
  ollama: OllamaMono as unknown as AppIcon,
};

/** The avatar paint per vendor id: a brand-coloured disc with the collection's own ink. */
export const AVATAR_PAINT: Record<string, { background: string; color: string }> = {
  anthropic: { background: anthropicBg, color: anthropicInk },
  openai: { background: openaiBg, color: openaiInk },
  gemini: { background: geminiBg, color: geminiInk },
  deepseek: { background: deepseekBg, color: deepseekInk },
  moonshot: { background: moonshotBg, color: moonshotInk },
  zhipu: { background: zhipuBg, color: zhipuInk },
  qwen: { background: qwenBg, color: qwenInk },
  siliconflow: { background: siliconflowBg, color: siliconflowInk },
  openrouter: { background: openrouterBg, color: openrouterInk },
  groq: { background: groqBg, color: groqInk },
  xai: { background: xaiBg, color: xaiInk },
  mistral: { background: mistralBg, color: mistralInk },
  ollama: { background: ollamaBg, color: ollamaInk },
};
