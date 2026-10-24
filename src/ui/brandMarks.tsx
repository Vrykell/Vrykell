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
import AmpColor from '@lobehub/icons/es/Amp/components/Color.js';
import ClaudeCodeColor from '@lobehub/icons/es/ClaudeCode/components/Color.js';
import ClineMono from '@lobehub/icons/es/Cline/components/Mono.js';
import CodexColor from '@lobehub/icons/es/Codex/components/Color.js';
import CursorMono from '@lobehub/icons/es/Cursor/components/Mono.js';
import DevinColor from '@lobehub/icons/es/Devin/components/Color.js';
import GeminiCLIColor from '@lobehub/icons/es/GeminiCLI/components/Color.js';
import GooseMono from '@lobehub/icons/es/Goose/components/Mono.js';
import KiloCodeMono from '@lobehub/icons/es/KiloCode/components/Mono.js';
import OpenCodeMono from '@lobehub/icons/es/OpenCode/components/Mono.js';
import RooCodeMono from '@lobehub/icons/es/RooCode/components/Mono.js';
import WindsurfMono from '@lobehub/icons/es/Windsurf/components/Mono.js';
import ZeroOneColor from '@lobehub/icons/es/ZeroOne/components/Color.js';
import AntigravityColor from '@lobehub/icons/es/Antigravity/components/Color.js';
import CodeBuddyColor from '@lobehub/icons/es/CodeBuddy/components/Color.js';
import CodeGeeXColor from '@lobehub/icons/es/CodeGeeX/components/Color.js';
import CommandCodeColor from '@lobehub/icons/es/CommandCode/components/Color.js';
import CopilotColor from '@lobehub/icons/es/Copilot/components/Color.js';
import CrewAIColor from '@lobehub/icons/es/CrewAI/components/Color.js';
import GithubCopilotMono from '@lobehub/icons/es/GithubCopilot/components/Mono.js';
import HermesAgentMono from '@lobehub/icons/es/HermesAgent/components/Mono.js';
import JunieColor from '@lobehub/icons/es/Junie/components/Color.js';
import KimiColor from '@lobehub/icons/es/Kimi/components/Color.js';
import KiroColor from '@lobehub/icons/es/Kiro/components/Color.js';
import KwaipilotColor from '@lobehub/icons/es/Kwaipilot/components/Color.js';
import ManusMono from '@lobehub/icons/es/Manus/components/Mono.js';
import OpenClawColor from '@lobehub/icons/es/OpenClaw/components/Color.js';
import OpenHandsColor from '@lobehub/icons/es/OpenHands/components/Color.js';
import PhindMono from '@lobehub/icons/es/Phind/components/Mono.js';
import PiMono from '@lobehub/icons/es/Pi/components/Mono.js';
import QoderColor from '@lobehub/icons/es/Qoder/components/Color.js';
import TraeColor from '@lobehub/icons/es/Trae/components/Color.js';
import ZencoderColor from '@lobehub/icons/es/Zencoder/components/Color.js';
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
export const OpenCodeMark = OpenCodeMono as unknown as AppIcon;

/**
 * Marks of the ACP-capable agents, keyed by the normalised name a harness entry carries (lowercase,
 * letters and digits only — see harnessPresets). These are the agents' own icons, which is what a
 * server list should show; a name that is not here falls back to the vendor detection.
 */
export const AGENT_MARKS: Record<string, AppIcon> = {
  claudecode: ClaudeCodeColor as unknown as AppIcon,
  codex: CodexColor as unknown as AppIcon,
  geminicli: GeminiCLIColor as unknown as AppIcon,
  opencode: OpenCodeMark,
  goose: GooseMono as unknown as AppIcon,
  cline: ClineMono as unknown as AppIcon,
  cursor: CursorMono as unknown as AppIcon,
  amp: AmpColor as unknown as AppIcon,
  kilocode: KiloCodeMono as unknown as AppIcon,
  roocode: RooCodeMono as unknown as AppIcon,
  windsurf: WindsurfMono as unknown as AppIcon,
  devin: DevinColor as unknown as AppIcon,
  '01': ZeroOneColor as unknown as AppIcon,
  antigravity: AntigravityColor as unknown as AppIcon,
  codebuddy: CodeBuddyColor as unknown as AppIcon,
  codegeex: CodeGeeXColor as unknown as AppIcon,
  commandcode: CommandCodeColor as unknown as AppIcon,
  copilot: CopilotColor as unknown as AppIcon,
  githubcopilot: GithubCopilotMono as unknown as AppIcon,
  crewai: CrewAIColor as unknown as AppIcon,
  hermesagent: HermesAgentMono as unknown as AppIcon,
  junie: JunieColor as unknown as AppIcon,
  kiro: KiroColor as unknown as AppIcon,
  kirocli: KiroColor as unknown as AppIcon,
  kimi: KimiColor as unknown as AppIcon,
  kimicli: KimiColor as unknown as AppIcon,
  kwaipilot: KwaipilotColor as unknown as AppIcon,
  manus: ManusMono as unknown as AppIcon,
  openclaw: OpenClawColor as unknown as AppIcon,
  openhands: OpenHandsColor as unknown as AppIcon,
  phind: PhindMono as unknown as AppIcon,
  pi: PiMono as unknown as AppIcon,
  qoder: QoderColor as unknown as AppIcon,
  trae: TraeColor as unknown as AppIcon,
  zencoder: ZencoderColor as unknown as AppIcon,
};
