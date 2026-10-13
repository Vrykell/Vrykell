import { t } from '@i18n';
/**
 * ModelPill — model selection control.
 *
 * Layout (about 7:3, split by a divider):
 *   [ icon · model name ] | [ thinking level + chevron ]
 *  - Clicking the name area opens the model picker dialog.
 *  - Clicking the level area opens the thinking-level menu in place, matching the
 *    control width and top edge; the control is hidden while the menu is open.
 *
 * The control uses the same rounded-square shape as the permission button and stays
 * transparent until hovered.
 */
import { useEffect, useRef, useState } from 'react';
import { iconSizes, ChevronDown, type AppIcon  } from '@ui/icons';
import { useAiConfigStore, useAgentSettings } from '@features/agent';
import { modelIcon } from '@features/agent/components/modelIcon';
import ModelPicker from '@features/chat/components/ModelPicker';

const LEVEL_LABEL: Record<string, string> = { low: '低', medium: '中', high: '高' };
const LEVELS = ['low', 'medium', 'high'] as const;

export default function ModelPill({ showThinking = true }: { showThinking?: boolean }) {
  const aiCfg = useAiConfigStore();
  const activeModel = useAiConfigStore((s) => s.activeModel);
  const agentSettings = useAgentSettings();
  const eff = agentSettings.resolve(activeModel);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [levelOpen, setLevelOpen] = useState(false);
  // 打开强度下拉时锁定胶囊当前宽度（fit-content 在菜单出现后会塌缩）
  const pillRef = useRef<HTMLDivElement>(null);
  const [lockedWidth, setLockedWidth] = useState<number | null>(null);

  const Icon: AppIcon = modelIcon(aiCfg.provider, aiCfg.model);
  const name = aiCfg.models.find((m) => m.id === activeModel)?.name || aiCfg.model || '模型';
  /** 模型名最长 35 字符，超出截断加省略号 */
  const MAX_NAME_LEN = 35;
  const displayName = name.length > MAX_NAME_LEN ? `${name.slice(0, MAX_NAME_LEN)}…` : name;
  const levelLabel = LEVEL_LABEL[eff.thinkingLevel] ?? '高';

  // 强度下拉打开期间 Esc 关闭
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
      className="model-pill" data-picker-open={pickerOpen} data-level-open={levelOpen}
      data-testid="model-pill"
      style={{
        position: 'relative', flexShrink: showThinking ? 0 : 1, minWidth: 0, maxWidth: '100%',
        width: levelOpen && lockedWidth ? lockedWidth : 'fit-content',
        height: 32, boxSizing: 'border-box',
        display: 'flex', alignItems: 'stretch',
        borderRadius: 8,
        overflow: levelOpen ? 'visible' : 'hidden',
        transition: 'background 0.12s ease',
      }}
    >
      {levelOpen ? (
        /* 思考强度下拉：原位覆盖胶囊（宽度一致、顶端对齐） */
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
            onClick={() => setLevelOpen(false)}
          />
          <div
            data-testid="think-level-menu"
            className="workspace-floating"
            style={{
              position: 'absolute', top: 0, left: 0, zIndex: 9999,
              width: '100%', boxSizing: 'border-box',
              padding: 4,
            }}
          >
            <div style={{ fontSize: 'calc(10px * var(--ui-font-scale))', color: 'var(--text-muted)', padding: '4px 8px 2px' }}>
              思考强度
            </div>
            {LEVELS.map((lv) => {
              const on = eff.thinkingLevel === lv;
              return (
                <button
                  key={lv}
                  className="workspace-floating-row" data-selected={on}
                  data-testid={`think-option-${lv}`}
                  aria-pressed={on}
                  onClick={() => {
                    agentSettings.updateModel(activeModel, { thinkingLevel: lv });
                    setLevelOpen(false);
                  }}
                  onMouseEnter={(e) => {
                    if (!on) e.currentTarget.style.background = 'var(--hover)';
                  }}
                  onMouseLeave={(e) => {
                    if (!on) e.currentTarget.style.background = 'transparent';
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                    height: 30, padding: '0 8px', boxSizing: 'border-box',
                    fontSize: 'calc(12px * var(--ui-font-scale))', textAlign: 'left',
                    border: 'none', borderRadius: 'var(--radius-inner)', cursor: 'pointer',
                    color: on ? 'var(--text-primary)' : 'var(--text-secondary)',
                  }}
                >
                  <span style={{ flex: 1 }}>{LEVEL_LABEL[lv]}</span>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <>
          {/* 名称区（约 70%）：打开模型选择窗口 */}
          <button
            data-testid="pill-name"
            aria-label={t('Choose model')}
            data-tip={t('Choose model')}
            data-tip-description={name}
            onClick={() => setPickerOpen(true)}
            style={{
              flex: showThinking ? '0 0 auto' : '1 1 auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: 6,
              padding: showThinking ? '0 10px 0 12px' : '0 10px', background: 'transparent', border: 'none',
              cursor: 'pointer',
            }}
          >
            <Icon size={iconSizes.row} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
            <span
              style={{
                fontSize: 'calc(12px * var(--ui-font-scale))', fontWeight: 'var(--fw-medium)', color: 'var(--text-primary)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >
              {displayName}
            </span>
            {!showThinking && <ChevronDown size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
          </button>
          {showThinking && <><span
            style={{
              width: 1, margin: '4px 0', flexShrink: 0,
              background: 'var(--border-strong)',
            }}
          />
          {/* 强度区（约 30%）：原位弹出思考强度下拉 */}
          <button
            data-testid="pill-level"
            data-tip={`思考强度：${levelLabel}`}
            onClick={() => {
              setLockedWidth(pillRef.current?.offsetWidth ?? null);
              setLevelOpen(true);
            }}
            style={{
              flex: 3, minWidth: 0, display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: 3, padding: '0 8px',
              background: 'transparent', border: 'none', cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-secondary)' }}>{levelLabel}</span>
            <ChevronDown size={iconSizes.compact} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          </button></>}
        </>
      )}

      <ModelPicker open={pickerOpen} onClose={() => setPickerOpen(false)} showThinking={showThinking} />
    </div>
  );
}
