/**
 * AiStatusBar — 终端 pane 顶部的 AI 状态栏（仅 AI 模式显示）：
 * 模型下拉 · 上下文圆环 · 深思/Agent 开关，与聊天面板顶栏同构。
 */
import Toggle from '@ui/StateIconButton';
import { t } from '@i18n';
import { Bot, Brain } from '@ui/icons';
import { useInputStore, selectPaneInput } from '@features/terminal';
import { useAiConfigStore, useAgentSettings } from '@features/agent';
import ModelPill from '@features/chat/components/ModelPill';
import ContextRing from '@features/chat/components/ContextRing';

export default function AiStatusBar({ paneId }: { paneId: string }) {
  const aiMode = useInputStore(selectPaneInput(paneId)).aiMode;
  const activeModel = useAiConfigStore((s) => s.activeModel);
  const agentSettings = useAgentSettings();
  // 注意：resolve() 每次返回新对象，不能放进 zustand selector（会触发 useSyncExternalStore 无限循环）
  const eff = agentSettings.resolve(activeModel);

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
      <ModelPill />
      <ContextRing />
      <div style={{ flex: 1 }} />
      <Toggle
        icon={Brain}
        on={eff.deepThink}
        title={t('Deep thinking')}
        onClick={() => agentSettings.updateModel(activeModel, { deepThink: !eff.deepThink })}
      />
      <Toggle
        icon={Bot}
        on={eff.agentMode}
        title={t(eff.agentMode ? 'Agent mode' : 'Chat only')}
        description={t(eff.agentMode ? 'Allow AI to use tools.' : 'Tools are turned off.')}
        onClick={() => agentSettings.updateModel(activeModel, { agentMode: !eff.agentMode })}
      />

    </div>
  );
}
