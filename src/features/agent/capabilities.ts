/**
 * capabilities — 模型能力探测（创建/导入模型时自动判定）。
 *
 * 四个能力维度：
 *   vision    视觉输入（图片）
 *   reasoning 深度推理/思考模式
 *   tools     工具调用
 *   search    服务商原生联网搜索（不依赖第三方兜底）
 *
 * 判定是启发式（按服务商 + 模型名），足够准确且零成本；
 * 结果随 ModelProfile 持久化，设置页/模型选择窗口据此打标签。
 */
import type { ProviderKind } from '@features/agent/provider';

export type ModelCapability = 'vision' | 'reasoning' | 'tools' | 'search';

export interface ModelCapabilities {
  vision: boolean;
  reasoning: boolean;
  tools: boolean;
  search: boolean;
}

export const CAPABILITY_LABELS: Record<ModelCapability, string> = {
  vision: '视觉',
  reasoning: '推理',
  tools: '工具',
  search: '搜索',
};

/** 服务商原生搜索：anthropic / gemini 内置联网工具，openai-compatible 无。 */
const NATIVE_SEARCH_PROVIDERS = new Set<ProviderKind>(['anthropic', 'gemini']);

/** 工具调用能力：嵌入/语音/转写类模型不支持。 */
const NO_TOOLS_RE = /embedding|rerank|tts|whisper|transcri|moderation|dall-e|image/i;

/** 推理能力（名字启发式；anthropic/gemini 现代模型均支持思考模式）。 */
const REASONING_RE =
  /reasoner|reasoning|thinking|think|o1|o3|o4|gpt-5|deepseek-r1|deepseek-.*-reasoner|kimi.*thinking|glm-4\.5|glm-4\.6|qwen3|qwen3-|moonshot-v1|doubao-.*-think|claude-sonnet|claude-opus|gemini-2\.5/g;

/** 视觉能力（名字启发式；anthropic/gemini 原生支持）。 */
const VISION_RE =
  /gpt-4o|gpt-4\.1|gpt-5|o1|o3|o4|vision|\bvl\b|qwen.*vl|qwen2\.5-vl|glm-4v|glm-4\.1v|claude|gemini|minicpm|internvl|phi-4|pixtral|llava|step-1v/i;

export function detectCapabilities(provider: ProviderKind, model: string): ModelCapabilities {
  const m = model || '';
  return {
    vision: provider === 'anthropic' || provider === 'gemini' || VISION_RE.test(m),
    reasoning: REASONING_RE.test(m),
    tools: !NO_TOOLS_RE.test(m),
    search: NATIVE_SEARCH_PROVIDERS.has(provider),
  };
}

/** 模型是否具有某项能力（profile 未探测过时用启发式兜底）。 */
export function hasCapability(
  caps: ModelCapabilities | undefined,
  capability: ModelCapability,
  provider: ProviderKind,
  model: string,
): boolean {
  if (!caps) return detectCapabilities(provider, model)[capability];
  return caps[capability];
}
