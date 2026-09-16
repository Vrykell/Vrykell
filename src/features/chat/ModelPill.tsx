/**
 * ModelPill — 模型选择胶囊（终端 AI 状态栏 / 聊天面板顶栏共用）。
 *
 * 结构（约 7:3，竖线分隔）：
 *   [ 图标(稍大) · 模型名 ] | [ 思考强度 + 下拉提示 ]
 *  - 点击名称区 → 打开模型选择窗口（ModelPicker）
 *  - 点击强度区 → 原位打开思考强度下拉：宽度与胶囊一致、顶端对齐正好覆盖
 *    胶囊位置；下拉出现期间胶囊隐藏，选择完毕后关闭并恢复胶囊。
 *
 * 未悬停时胶囊透明无边框，只显示文字与图标；悬停显示背景。
 */
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, type LucideIcon } from 'lucide-react';
import { useAiConfigStore } from '@/lib/ai';
import { useAgentSettings } from '@features/agent/agentSettings';
import { modelIcon } from '@features/agent/modelIcon';
import ModelPicker from './ModelPicker';

const LEVEL_LABEL: Record<string, string> = { low: '低', medium: '中', high: '高' };
const LEVELS = ['low', 'medium', 'high'] as const;

export default function ModelPill() {
  const aiCfg = useAiConfigStore();
  const activeModel = useAiConfigStore((s) => s.activeModel);
  const agentSettings = useAgentSettings();
  const eff = agentSettings.resolve(activeModel);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [levelOpen, setLevelOpen] = useState(false);
  // 打开强度下拉时锁定胶囊当前宽度（fit-content 在菜单出现后会塌缩）
  const pillRef = useRef<HTMLDivElement>(null);
  const [lockedWidth, setLockedWidth] = useState<number | null>(null);

  const Icon: LucideIcon = modelIcon(aiCfg.provider, aiCfg.model);
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
      data-testid="model-pill"
      style={{
        position: 'relative', flexShrink: 0,
        width: levelOpen && lockedWidth ? lockedWidth : 'fit-content',
        height: 30, boxSizing: 'border-box',
        display: 'flex', alignItems: 'stretch',
        borderRadius: 999,
        overflow: levelOpen ? 'visible' : 'hidden',
        background: 'transparent',
        transition: 'background 0.12s ease',
      }}
      onMouseEnter={(e) => {
        if (!levelOpen && !pickerOpen) e.currentTarget.style.background = 'var(--button-hover)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
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
            style={{
              position: 'absolute', top: 0, left: 0, zIndex: 9999,
              width: '100%', boxSizing: 'border-box',
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 10, boxShadow: 'var(--shadow-md)', padding: 4,
            }}
          >
            <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '4px 8px 2px' }}>
              思考强度
            </div>
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
                  onMouseEnter={(e) => {
                    if (!on) e.currentTarget.style.background = 'var(--hover)';
                  }}
                  onMouseLeave={(e) => {
                    if (!on) e.currentTarget.style.background = 'transparent';
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                    height: 30, padding: '0 8px', boxSizing: 'border-box',
                    fontSize: 12, textAlign: 'left',
                    background: on ? 'var(--hover)' : 'transparent',
                    border: 'none', borderRadius: 6, cursor: 'pointer',
                    color: on ? 'var(--text-primary)' : 'var(--text-secondary)',
                  }}
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
          {/* 名称区（约 70%）：打开模型选择窗口 */}
          <button
            data-testid="pill-name"
            title="切换模型（更多在设置页配置）"
            onClick={() => setPickerOpen(true)}
            style={{
              flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 6,
              padding: '0 10px 0 12px', background: 'transparent', border: 'none',
              cursor: 'pointer',
            }}
          >
            <Icon size={15} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
            <span
              style={{
                fontSize: 12, fontWeight: 500, color: 'var(--text-primary)',
                whiteSpace: 'nowrap',
              }}
            >
              {displayName}
            </span>
          </button>
          {/* 竖线分隔 */}
          <span
            style={{
              width: 1, margin: '4px 0', flexShrink: 0,
              background: 'var(--border-strong)',
            }}
          />
          {/* 强度区（约 30%）：原位弹出思考强度下拉 */}
          <button
            data-testid="pill-level"
            title={`思考强度：${levelLabel}`}
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
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{levelLabel}</span>
            <ChevronDown size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          </button>
        </>
      )}

      <ModelPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </div>
  );
}
