/**
 * ModelPill — 模型选择胶囊（终端 AI 状态栏 / 聊天面板顶栏共用）。
 */
import { Check, ChevronDown, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAgentSettings } from '@/features/agent/agentSettings';
import { modelIcon } from '@/features/agent/modelIcon';
import ModelPicker from '@/features/chat/ModelPicker';
import { useAiConfigStore } from '@/services/tauri/ai';
import { cx } from '@/shared/utils/cx';
import s from './ModelPill.module.css';

const LEVEL_LABEL: Record<string, string> = { low: '低', medium: '中', high: '高' };
const LEVELS = ['low', 'medium', 'high'] as const;

export default function ModelPill() {
  const aiCfg = useAiConfigStore();
  const activeModel = useAiConfigStore((s) => s.activeModel);
  const agentSettings = useAgentSettings();
  const eff = agentSettings.resolve(activeModel);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [levelOpen, setLevelOpen] = useState(false);
  const pillRef = useRef<HTMLDivElement>(null);
  const [lockedWidth, setLockedWidth] = useState<number | null>(null);

  const Icon: LucideIcon = modelIcon(aiCfg.provider, aiCfg.model);
  const name = aiCfg.models.find((m) => m.id === activeModel)?.name || aiCfg.model || '模型';
  const MAX_NAME_LEN = 35;
  const displayName = name.length > MAX_NAME_LEN ? `${name.slice(0, MAX_NAME_LEN)}…` : name;
  const levelLabel = LEVEL_LABEL[eff.thinkingLevel] ?? '高';

  useEffect(() => {
    if (!levelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLevelOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [levelOpen]);

  return (
    <div
      ref={pillRef}
      data-testid="model-pill"
      className={s.pill}
      style={{
        width: levelOpen && lockedWidth ? lockedWidth : 'fit-content',
        overflow: levelOpen ? 'visible' : 'hidden',
      }}
    >
      {levelOpen ? (
        <>
          <div className={s.overlay} onClick={() => setLevelOpen(false)} />
          <div data-testid="think-level-menu" className={s.menu}>
            <div className={s.menuLabel}>思考强度</div>
            {LEVELS.map((lv) => {
              const on = eff.thinkingLevel === lv;
              return (
                <button
                  key={lv}
                  data-testid={`think-option-${lv}`}
                  onClick={() => {
                    agentSettings.updateModel(activeModel, { thinkingLevel: lv });
                    setLevelOpen(false);
                  }}
                  className={cx(s.levelBtn, on ? s.levelBtnOn : s.levelBtnOff)}
                >
                  <span style={{ flex: 1 }}>{LEVEL_LABEL[lv]}</span>
                  {on && <Check size={12} style={{ color: 'var(--accent)' }} />}
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <button
            data-testid="pill-name"
            title="切换模型（更多在设置页配置）"
            onClick={() => setPickerOpen(true)}
            className={s.nameBtn}
          >
            <Icon size={15} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
            <span className={s.nameText}>{displayName}</span>
          </button>
          <span className={s.divider} />
          <button
            data-testid="pill-level"
            title={`思考强度：${levelLabel}`}
            onClick={() => {
              setLockedWidth(pillRef.current?.offsetWidth ?? null);
              setLevelOpen(true);
            }}
            className={s.levelBtn2}
          >
            <span className={s.levelText}>{levelLabel}</span>
            <ChevronDown size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          </button>
        </>
      )}
      <ModelPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </div>
  );
}
