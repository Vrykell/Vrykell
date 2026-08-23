/**
 * agentSettings — agent 相关的 UI 设置（localStorage 持久化）。
 *
 * 与 Rust 侧 config.json 的分工：这里只放「即时生效的 UI 开关/偏好」，
 * key/provider/model 等连接配置仍在 Rust（见 lib/ai.ts 的镜像 store）。
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AgentSettingsState {
  /** Agent 模式：开 = 注册全部工具；关 = 纯聊天（零工具） */
  agentMode: boolean;
  /** 联网搜索开关（未配 key/不支持时 UI 置灰） */
  webSearch: boolean;
  /** 深度思考开关（providerOptions 透传 reasoning_effort） */
  deepThink: boolean;
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
  update: (patch: Partial<Omit<AgentSettingsState, 'update'>>) => void;
}

export const useAgentSettings = create<AgentSettingsState>()(
  persist(
    (set) => ({
      agentMode: true,
      webSearch: false,
      deepThink: false,
      autoTitle: true,
      titleModel: '',
      completeEnabled: true,
      completeModel: '',
      completeDebounceMs: 200,
      update: (patch) => set(patch),
    }),
    { name: 'vrykell-agent-settings' },
  ),
);
