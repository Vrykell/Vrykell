/**
 * modelIcon — 模型图标映射（模型选择窗口 / 设置页模型列表 / 模型选择条共用）。
 *
 * 按服务商给主图标，推理型模型叠加专属图标，保证视觉可区分。
 */
import { Bot, BrainCircuit, type LucideIcon, Orbit, Sparkles } from 'lucide-react';
import type { ProviderKind } from '@/agent/provider';

const REASONING_RE =
  /reasoner|reasoning|thinking|think|o1|o3|o4|gpt-5|deepseek-r1|claude-sonnet|claude-opus|gemini-2\.5-pro|kimi.*thinking/i;

/** 模型主图标：推理型优先，其次按服务商。 */
export function modelIcon(provider: ProviderKind, model: string): LucideIcon {
  if (REASONING_RE.test(model || '')) return BrainCircuit;
  switch (provider) {
    case 'anthropic':
      return Sparkles;
    case 'gemini':
      return Orbit;
    default:
      return Bot;
  }
}

export function providerLabel(provider: ProviderKind): string {
  switch (provider) {
    case 'anthropic':
      return 'Anthropic';
    case 'gemini':
      return 'Gemini';
    default:
      return 'OpenAI 兼容';
  }
}
