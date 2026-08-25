/**
 * AiStatusBar — 终端 pane 顶部的 AI 状态栏（仅 AI 模式显示）：
 * 模型下拉 · 上下文圆环 · 深思/Agent 开关，与聊天面板顶栏同构。
 */
import { useState } from 'react';
import { Bot, Brain, type LucideIcon } from 'lucide-react';
import { useInputStore, selectPaneInput } from '../stores/input';
import { useAiConfigStore, setAiModel, setActiveModel } from '../lib/ai';
import { useAgentSettings } from '../agent/agentSettings';
import ContextMenu from '../components/ContextMenu';
import ContextRing from '../components/ContextRing';

/** 各 provider 的常用模型（快捷下拉；完整自由度在设置页输入） */
const MODEL_PRESETS: Record<string, string[]> = {
  'openai-compatible': [
    'gpt-4o-mini', 'gpt-4o', 'deepseek-chat', 'deepseek-reasoner',
    'qwen-plus', 'glm-4-plus', 'moonshot-v1-8k',
  ],
  anthropic: ['claude-sonnet-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
};

function Toggle({ icon: Icon, on, title, onClick }: {
  icon: LucideIcon;
  on: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      data-subtle
      title={title}
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 24, height: 24, padding: 0, border: 'none', borderRadius: 4,
        background: 'transparent', color: on ? 'var(--accent-warm)' : 'var(--text-muted)',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--button-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <Icon size={13} />
    </button>
  );
}

export default function AiStatusBar({ paneId }: { paneId: string }) {
  const aiMode = useInputStore(selectPaneInput(paneId)).aiMode;
  const aiCfg = useAiConfigStore();
  const activeModel = useAiConfigStore((s) => s.activeModel);
  const agentSettings = useAgentSettings();
  // 注意：resolve() 每次返回新对象，不能放进 zustand selector（会触发 useSyncExternalStore 无限循环）
  const eff = agentSettings.resolve(activeModel);
  const [modelMenu, setModelMenu] = useState<{ x: number; y: number } | null>(null);

  if (!aiMode) return null;

  return (
    <div
      data-testid="ai-status-bar"
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '6px 10px 2px', userSelect: 'none',
        flexShrink: 0,
      }}
    >
      <button
        data-subtle
        title="切换模型（更多在设置页配置）"
        onClick={(e) => setModelMenu({ x: e.clientX, y: e.clientY })}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, height: 24, boxSizing: 'border-box',
          fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500,
          padding: '0 8px', border: '1px solid var(--border)', borderRadius: 5,
          background: 'var(--canvas)', color: 'var(--text-secondary)', cursor: 'pointer',
          lineHeight: '16px', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        {aiCfg.models.find((m) => m.id === aiCfg.activeModel)?.name || aiCfg.model || '模型'}
        <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>▾</span>
      </button>
      <ContextRing />
      <div style={{ flex: 1 }} />
      <Toggle
        icon={Brain}
        on={eff.deepThink}
        title="深度思考"
        onClick={() => agentSettings.updateModel(activeModel, { deepThink: !eff.deepThink })}
      />
      <Toggle
        icon={Bot}
        on={eff.agentMode}
        title={eff.agentMode ? 'Agent 模式（可使用工具）' : '纯聊天（工具已关闭）'}
        onClick={() => agentSettings.updateModel(activeModel, { agentMode: !eff.agentMode })}
      />

      {modelMenu && (
        <ContextMenu
          anchor={modelMenu}
          items={[
            ...(aiCfg.models.length > 0
              ? aiCfg.models.map((m) => ({
                  label: m.id === aiCfg.activeModel ? `✓ ${m.name || m.model}` : (m.name || m.model),
                  onClick: () => void setActiveModel(m.id),
                }))
              : (MODEL_PRESETS[aiCfg.provider] ?? []).map((m) => ({
                  label: m === aiCfg.model ? `✓ ${m}` : m,
                  onClick: () => void setAiModel(m),
                }))),
            { label: '─ 思考强度 ─', onClick: () => {} },
            ...[['low', '低'], ['medium', '中'], ['high', '高'] as const].map(([lv, label]) => ({
              label: `${eff.thinkingLevel === lv ? '✓ ' : ''}${label}`,
              onClick: () => agentSettings.updateModel(activeModel, { thinkingLevel: lv as 'low' | 'medium' | 'high' }),
            })),
          ]}
          onClose={() => setModelMenu(null)}
        />
      )}
    </div>
  );
}
