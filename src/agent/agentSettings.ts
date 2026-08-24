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

/** 可绑定模型的行为设置（每模型可覆盖，反映「这个模型怎么用」） */
export interface ModelBehaviorSettings {
  /** Agent 模式：开 = 注册全部工具；关 = 纯聊天（零工具） */
  agentMode: boolean;
  /** 联网搜索开关（未配 key/不支持时 UI 置灰） */
  webSearch: boolean;
  /** 深度思考开关（providerOptions 透传 reasoning_effort / thinking budget） */
  deepThink: boolean;
  /** 最大迭代步数（AI SDK stepCountIs；1–20） */
  maxSteps: number;
  /** 保留最近 N 条消息作为上下文；0 = 不裁剪（全量） */
  contextMessages: number;
  /** 回复 token 上限；0 = provider 默认（anthropic 深思时自动抬到 16000） */
  maxOutputTokens: number;
  /** 采样温度；null = provider 默认 */
  temperature: number | null;
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
}

/** 生效设置 = 行为 + 全局偏好 */
export type AgentSettings = ModelBehaviorSettings & GlobalPrefs;

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  agentMode: true,
  webSearch: false,
  deepThink: false,
  autoTitle: true,
  titleModel: '',
  completeEnabled: true,
  completeModel: '',
  completeDebounceMs: 200,
  maxSteps: 8,
  contextMessages: 0,
  maxOutputTokens: 0,
  temperature: null,
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
      version: 2,
      migrate: (persisted: unknown, version: number) => {
        // v1 → v2：旧平铺结构 { agentMode, ..., update } 收进 global
        if (version < 2 && persisted && typeof persisted === 'object') {
          const old = persisted as Record<string, unknown>;
          if (!old.global) {
            const global: AgentSettings = { ...DEFAULT_AGENT_SETTINGS };
            for (const k of Object.keys(DEFAULT_AGENT_SETTINGS) as (keyof AgentSettings)[]) {
              if (k in old) {
                (global as unknown as Record<string, unknown>)[k] = old[k];
              }
            }
            return { global, overrides: {} };
          }
        }
        return persisted as { global: AgentSettings; overrides: Record<string, Partial<ModelBehaviorSettings>> };
      },
    },
  ),
);
