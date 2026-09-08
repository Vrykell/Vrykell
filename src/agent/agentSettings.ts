/**
 * agentSettings — agent 相关的 UI 设置（localStorage 持久化）。
 *
 * 分层设计（避免后期设置膨胀成一张平铺大表）：
 *   - global：全局默认（含「行为默认值」+ 全局偏好）
 *   - overrides：每个模型 id → 行为覆盖（只覆盖差异项）
 *   - resolve(modelId)：合并 global + 该模型 override，得到「生效值」
 *
 * 与 Rust 侧 config.json 的分工：这里放「即时生效的 UI/行为偏好」，
 * key/provider/model 等连接配置仍在 Rust（见 lib/ai.ts 的镜像 store）。
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ShellType } from '@/services/tauri/shells';

/** 上下文管理策略（code-agent 式） */
export type ContextStrategy = 'off' | 'window' | 'compact';

/** 可绑定模型的行为设置（每模型可覆盖，反映「这个模型怎么用」） */
export interface ModelBehaviorSettings {
  /** Agent 模式：开 = 注册全部工具；关 = 纯聊天（零工具） */
  agentMode: boolean;
  /** 深度思考开关（providerOptions 透传 reasoning_effort / thinking budget） */
  deepThink: boolean;
  /** 思考强度：low/medium/high（deepThink 开启时生效） */
  thinkingLevel: 'low' | 'medium' | 'high';
  /** 最大迭代步数（AI SDK stepCountIs；1–100） */
  maxSteps: number;
  /** 上下文策略：off=全量；window=按 token 预算窗口；compact=预算 + 自动摘要压缩 */
  contextStrategy: ContextStrategy;
  /** 上下文 token 预算（估算）；0 = 不设限 */
  contextMaxTokens: number;
  /** compact 摘要长度上限（token） */
  contextSummaryTokens: number;
  /** 单个工具输出截断字符数 */
  contextToolChars: number;
  /** 回复 token 上限；0 = provider 默认（anthropic 深思时自动抬到 16000） */
  maxOutputTokens: number;
  /** 采样温度；null = provider 默认 */
  temperature: number | null;
  /** 自定义系统提示词（空 = 使用内置默认提示词） */
  systemPrompt: string;
}

/** 全局偏好（应用级，不按模型覆盖） */
export interface GlobalPrefs {
  /** 智能标题开关 */
  autoTitle: boolean;
  /** 标题生成模型（空 = 沿用聊天模型） */
  titleModel: string;
  /** 命令自动补全开关 */
  completeEnabled: boolean;
  /** 补全模型（空 = 沿用聊天模型） */
  completeModel: string;
  /** 补全防抖毫秒 */
  completeDebounceMs: number;
  /** 各 shell 类型（bash/zsh/powershell/...）的默认打开模式 */
  openModeByShell: Record<ShellType, 'classic' | 'block'>;
  /** SSH 连接终端的打开模式：block = 向远端注入 shell integration（失败自动回退经典） */
  sshOpenMode: 'classic' | 'block';
}

/** 生效设置 = 行为 + 全局偏好 */
export type AgentSettings = ModelBehaviorSettings & GlobalPrefs;

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  agentMode: true,
  deepThink: false,
  thinkingLevel: 'high',
  autoTitle: true,
  titleModel: '',
  completeEnabled: true,
  completeModel: '',
  completeDebounceMs: 200,
  openModeByShell: {
    zsh: 'block',
    bash: 'block',
    powershell: 'block',
    pwsh: 'block',
    cmd: 'block',
  },
  sshOpenMode: 'classic',
  maxSteps: 50,
  contextStrategy: 'compact',
  contextMaxTokens: 24000,
  contextSummaryTokens: 400,
  contextToolChars: 8192,
  maxOutputTokens: 0,
  temperature: null,
  systemPrompt: '',
};

interface AgentSettingsState {
  global: AgentSettings;
  overrides: Record<string, Partial<ModelBehaviorSettings>>;
  /** 更新全局默认（含全局偏好与行为默认值） */
  update: (patch: Partial<AgentSettings>) => void;
  /** 更新某个模型的行为覆盖 */
  updateModel: (modelId: string, patch: Partial<ModelBehaviorSettings>) => void;
  /** 清除某个模型的行为覆盖（回落全局默认） */
  resetModel: (modelId: string) => void;
  /** 合并全局默认 + 模型覆盖得到生效值；不传 modelId = 纯全局 */
  resolve: (modelId?: string) => AgentSettings;
}

/** 本地终端（shell）的默认打开模式；未知 shell 回退 block。SSH 恒经典，不经过这里。 */
export function defaultOpenModeForShell(shellType?: string): 'classic' | 'block' {
  const t = (shellType || 'zsh') as ShellType;
  const map = useAgentSettings.getState().global.openModeByShell;
  return (map && map[t]) || 'block';
}

export const useAgentSettings = create<AgentSettingsState>()(
  persist(
    (set, get) => ({
      global: { ...DEFAULT_AGENT_SETTINGS },
      overrides: {},
      update: (patch) => set((s) => ({ global: { ...s.global, ...patch } })),
      updateModel: (modelId, patch) => {
        if (!modelId) {
          get().update(patch);
          return;
        }
        set((s) => ({
          overrides: { ...s.overrides, [modelId]: { ...s.overrides[modelId], ...patch } },
        }));
      },
      resetModel: (modelId) =>
        set((s) => {
          if (!(modelId in s.overrides)) return s;
          const overrides = { ...s.overrides };
          delete overrides[modelId];
          return { overrides };
        }),
      resolve: (modelId) => {
        const s = get();
        const ov = modelId ? s.overrides[modelId] : undefined;
        return { ...s.global, ...ov };
      },
    }),
    {
      name: 'vrykell-agent-settings',
      version: 8,
      migrate: (persisted: unknown, version: number) => {
        // v0/v1（平铺）→ 收进 global；v2（缺新字段）→ 补齐默认值
        let state: {
          global: AgentSettings;
          overrides: Record<string, Partial<ModelBehaviorSettings>>;
        };
        if (
          version < 2 &&
          persisted &&
          typeof persisted === 'object' &&
          !(persisted as { global?: unknown }).global
        ) {
          const flat = persisted as Record<string, unknown>;
          const global: AgentSettings = { ...DEFAULT_AGENT_SETTINGS };
          for (const k of Object.keys(DEFAULT_AGENT_SETTINGS) as (keyof AgentSettings)[]) {
            if (k in flat) {
              (global as unknown as Record<string, unknown>)[k] = flat[k];
            }
          }
          state = { global, overrides: {} };
        } else {
          state = persisted as {
            global: AgentSettings;
            overrides: Record<string, Partial<ModelBehaviorSettings>>;
          };
        }
        // 任意版本 → 补齐 global 缺省字段 + 保证 overrides 存在
        if (state && typeof state === 'object') {
          state.global = { ...DEFAULT_AGENT_SETTINGS, ...(state.global ?? {}) };
          state.overrides = state.overrides ?? {};
        }
        // v7：工具调用上限旧默认（<50）抬到 50
        if (state && typeof state.global.maxSteps === 'number' && state.global.maxSteps < 50) {
          state.global.maxSteps = 50;
        }
        return state;
      },
    },
  ),
);
