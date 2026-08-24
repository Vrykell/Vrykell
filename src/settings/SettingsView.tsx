import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Search, ChevronRight, Settings, Cpu, FileCode, Palette, Sun, Moon, Plus, X, Keyboard } from 'lucide-react';
import { loadConfig, saveConfig, type FileOpenConfig } from '../files/fileOpen';
import {
  refreshAiConfig, setAiModels, setActiveModel,
  setProviderKey, clearProviderKey,
  setTavilyKey, clearTavilyKey, useAiConfigStore,
  type ModelProfile,
} from '../lib/ai';
import type { ProviderKind } from '../agent/provider';
import { useAgentSettings, type AgentSettings, type ModelBehaviorSettings } from '../agent/agentSettings';
import Segmented from '../components/Segmented';
import { useTheme } from '../theme/ThemeProvider';
import { useToastStore } from '../components/Toast';
import {
  usePermissions, clearSessionGrants, TOOL_NAMES,
  type ToolLevel, type ToolName,
} from '../agent/permissions';

/** 权限页工具中文名（与 messageParts 的 TOOL_LABEL 保持同步） */
const PERM_TOOL_LABEL: Record<ToolName, string> = {
  run_command: '执行终端命令',
  read_file: '读取文件',
  write_file: '写入文件',
  edit_file: '修改文件',
  list_dir: '列目录',
  search_files: '搜索文件',
  web_search: '联网搜索',
};

// ── 设置页结构 ──
// 外层 = 按功能划分的组（大菜单，可展开）；内层 = 细分设置页（小菜单）。
// 每个设置页内再放多个相关的具体配置项。

type PageId = 'ai-model' | 'ai-behavior' | 'ai-perms' | 'ai-web' | 'editor-local' | 'editor-remote' | 'appearance-theme' | 'shortcuts';

interface SettingItem {
  id: PageId;
  label: string;
  keywords: string[];
}
interface SettingGroup {
  id: string;
  label: string;
  icon: typeof Settings;
  items: SettingItem[];
}

const GROUPS: SettingGroup[] = [
  {
    id: 'ai', label: 'AI 模型', icon: Cpu,
    items: [
      { id: 'ai-model', label: '模型配置', keywords: ['ai', 'model', 'api', 'key', 'baseurl', '模型', '密钥', '服务地址', 'provider', '服务商', 'anthropic', 'gemini'] },
      { id: 'ai-behavior', label: 'AI 行为', keywords: ['agent', '联网', '深思考', '思考', '智能标题', '标题', '自动补全', '补全', '防抖', 'debounce'] },
      { id: 'ai-perms', label: 'AI 权限', keywords: ['权限', '审批', 'permission', '工具', '许可', '授权', '危险命令'] },
      { id: 'ai-web', label: '网络搜索', keywords: ['tavily', '联网', '搜索', 'web', 'search', 'grounding'] },
    ],
  },
  {
    id: 'editor', label: '编辑器', icon: FileCode,
    items: [
      { id: 'editor-local', label: '本地编辑器', keywords: ['编辑器', 'editor', 'vim', '本地', '扩展名', '模板'] },
      { id: 'editor-remote', label: '远程编辑器', keywords: ['远程', 'remote', 'ssh', '编辑器', '扩展名', '模板'] },
    ],
  },
  {
    id: 'appearance', label: '外观', icon: Palette,
    items: [
      { id: 'appearance-theme', label: '主题', keywords: ['主题', 'theme', '深色', '浅色', '暗色'] },
    ],
  },
  {
    id: 'shortcuts', label: '快捷键', icon: Keyboard,
    items: [
      { id: 'shortcuts', label: '快捷键说明', keywords: ['快捷键', 'shortcut', 'key', '键位', '分屏', '搜索'] },
    ],
  },
];

// ── 通用样式 ──

const inputStyle: React.CSSProperties = {
  background: 'var(--canvas)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-inner)', padding: '6px 8px', fontSize: 12,
  color: 'var(--text-primary)', outline: 'none', width: '100%',
  fontFamily: 'var(--font-mono)', boxSizing: 'border-box',
};

const btnStyle: React.CSSProperties = {
  padding: '5px 12px', fontSize: 12, border: '1px solid var(--border)',
  borderRadius: 'var(--radius-inner)', background: 'transparent',
  color: 'var(--text-secondary)', cursor: 'pointer',
};

/**
 * SettingsView — 设置标签页内容（与「会话历史」同级，作为一个会话看待）。
 * 左侧分级侧栏（组可展开 + 搜索过滤），右侧为当前设置页（页内含多个相关配置）。
 */
export default function SettingsView() {
  const [selected, setSelected] = useState<PageId>('ai-model');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(GROUPS.map((g) => g.id)));
  const [query, setQuery] = useState('');

  // 文件打开配置（localStorage）
  const [fileCfg, setFileCfg] = useState<FileOpenConfig>(() => loadConfig());
  const updateFileCfg = (patch: Partial<FileOpenConfig>) => {
    setFileCfg((prev) => {
      const next = { ...prev, ...patch };
      saveConfig(next);
      return next;
    });
  };

  // AI 配置（Rust 后端；store 镜像供响应式订阅，key 只写不回显）
  const aiCfg = useAiConfigStore();
  const [tavilyDraft, setTavilyDraft] = useState('');
  const toast = (msg: string, type: 'info' | 'success' | 'error') =>
    useToastStore.getState().addToast(msg, type);

  // AI 权限（M3）：持久化默认级别 + 内存会话授权
  const permLevels = usePermissions((s) => s.levels);
  const setPermLevel = usePermissions((s) => s.setLevel);

  useEffect(() => {
    refreshAiConfig();
  }, []);

  // 搜索过滤：命中项保留，自动展开其所在组
  const q = query.trim().toLowerCase();
  const visibleGroups = useMemo(() => {
    if (!q) return GROUPS;
    return GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((it) =>
        it.label.toLowerCase().includes(q) || it.keywords.some((k) => k.toLowerCase().includes(q)),
      ),
    })).filter((g) => g.items.length > 0);
  }, [q]);

  const toggleGroup = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const activeLabel =
    GROUPS.flatMap((g) => g.items).find((it) => it.id === selected)?.label ?? '设置';

  const renderPage = (): ReactNode => {
    switch (selected) {
      case 'ai-model':
        return <AiModelPage />;

      case 'ai-behavior':
        return <AiBehaviorPage />;

      case 'ai-web': {
        const mode =
          aiCfg.provider === 'openai-compatible'
            ? aiCfg.hasTavilyKey ? 'Tavily 兜底（已配置）' : 'Tavily 兜底（未配置 Key，联网不可用）'
            : '服务商原生搜索（无需 Tavily）';
        return (
          <>
            <Field title="当前搜索方式" description="Anthropic / Gemini 走各自的原生联网搜索，无需额外配置；OpenAI 兼容服务没有原生搜索能力，用 Tavily 兜底。">
              <span style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 4,
                color: 'var(--text-secondary)', background: 'var(--hover)',
              }}>
                {mode}
              </span>
            </Field>
            <Field title="Tavily API Key" description="仅当服务商为 OpenAI 兼容时需要；从 tavily.com 免费获取。Key 仅存本机后端，界面不回显明文。">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 4,
                  color: aiCfg.hasTavilyKey ? 'var(--success)' : 'var(--text-muted)',
                  background: aiCfg.hasTavilyKey ? 'var(--success-bg)' : 'var(--hover)',
                }}>
                  {aiCfg.hasTavilyKey ? '已配置' : '未配置'}
                </span>
                {aiCfg.hasTavilyKey && (
                  <button
                    onClick={() => clearTavilyKey().then(() => toast('已清除 Tavily Key', 'success'))}
                    style={btnStyle}
                  >
                    清除
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="password"
                  value={tavilyDraft}
                  placeholder={aiCfg.hasTavilyKey ? '输入以覆盖（留空不改动）' : '输入 Tavily API Key'}
                  onChange={(e) => setTavilyDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitTavilyKey(); }}
                  style={inputStyle}
                />
                <button
                  onClick={commitTavilyKey}
                  style={{ ...btnStyle, background: 'var(--accent)', color: '#0d0d0d', border: 'none', flexShrink: 0 }}
                >
                  保存
                </button>
              </div>
            </Field>
          </>
        );
      }

      case 'ai-perms':
        return (
          <>
            <Field
              title="工具权限"
              description="允许 = AI 可直接使用；每次询问 = 在对话里弹审批卡；禁止 = 工具不注册给 AI。危险命令（rm -rf、sudo、pkill 等）无视本表，逐次询问。"
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {TOOL_NAMES.map((name) => {
                  const lv: ToolLevel = permLevels[name] ?? 'ask';
                  return (
                    <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flex: 1, fontSize: 12, color: 'var(--text-primary)' }}>
                        {PERM_TOOL_LABEL[name]}
                      </span>
                      <Segmented
                        size="sm"
                        options={(
                          [
                            ['allow', '允许'],
                            ['ask', '每次询问'],
                            ['deny', '禁止'],
                          ] as const
                        ).map(([v, label]) => ({ value: v, label }))}
                        value={lv}
                        onChange={(v) => setPermLevel(name, v)}
                      />
                    </div>
                  );
                })}
              </div>
            </Field>
            <Field
              title="会话授权"
              description="审批卡上点过「本会话允许」的工具会被记住，重启后自动失效；也可在此一键清空。"
            >
              <button
                style={btnStyle}
                onClick={() => {
                  clearSessionGrants();
                  toast('已清空全部会话授权', 'success');
                }}
              >
                清空会话授权
              </button>
            </Field>
          </>
        );

      case 'editor-local':
        return (
          <>
            <Field title="默认编辑器" description="本地文件双击打开时使用的编辑器命令；缺失时自动降级 vim → nano → vi。">
              <input
                value={fileCfg.defaultEditor}
                placeholder="vim"
                onChange={(e) => updateFileCfg({ defaultEditor: e.target.value })}
                style={inputStyle}
              />
            </Field>
            <Field title="按扩展名打开" description="为不同扩展名指定打开命令；{file} 为路径占位符，__system__ 表示用系统默认应用。">
              <TemplateListEditor
                value={fileCfg.templates}
                onChange={(templates) => updateFileCfg({ templates })}
                placeholder="如 code、__system__"
              />
            </Field>
          </>
        );

      case 'editor-remote':
        return (
          <>
            <Field title="默认编辑器" description="远程文件双击打开时，在 SSH 终端里使用的编辑器命令。">
              <input
                value={fileCfg.remoteEditor}
                placeholder="vim"
                onChange={(e) => updateFileCfg({ remoteEditor: e.target.value })}
                style={inputStyle}
              />
            </Field>
            <Field title="按扩展名打开" description="为远程不同扩展名指定打开命令；{file} 为路径占位符。">
              <TemplateListEditor
                value={fileCfg.remoteTemplates}
                onChange={(remoteTemplates) => updateFileCfg({ remoteTemplates })}
                placeholder="如 nvim、less"
              />
            </Field>
          </>
        );

      case 'appearance-theme':
        return <ThemePage />;

      case 'shortcuts':
        return <ShortcutPage />;

      default:
        return null;
    }
  };

  function commitTavilyKey() {
    const k = tavilyDraft.trim();
    if (!k) return;
    setTavilyKey(k)
      .then(() => { setTavilyDraft(''); toast('已保存 Tavily Key', 'success'); })
      .catch((e) => toast(String((e as Error)?.message ?? e), 'error'));
  }

  return (
    <div style={{
      flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row',
      background: 'var(--surface)', userSelect: 'none',
    }}>
      {/* 侧栏 */}
      <aside style={{
        width: 216, flexShrink: 0, borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', minHeight: 0,
      }}>
        <div style={{ padding: 8 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 8px', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-inner)', background: 'var(--canvas)',
          }}>
            <Search size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索设置…"
              style={{
                flex: 1, minWidth: 0, background: 'transparent', border: 'none',
                outline: 'none', fontSize: 12, color: 'var(--text-primary)',
              }}
            />
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 6px 8px' }}>
          {visibleGroups.map((g) => {
            const Icon = g.icon;
            const open = q ? true : expanded.has(g.id);
            return (
              <div key={g.id} style={{ marginBottom: 2 }}>
                <button
                  onClick={() => toggleGroup(g.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                    padding: '6px 8px', fontSize: 12, fontWeight: 600,
                    background: 'transparent', border: 'none', borderRadius: 5,
                    color: 'var(--text-primary)', cursor: 'pointer',
                  }}
                >
                  <ChevronRight
                    size={12}
                    style={{ color: 'var(--text-muted)', transition: 'transform 0.12s ease', transform: open ? 'rotate(90deg)' : 'none' }}
                  />
                  <Icon size={13} style={{ color: 'var(--text-muted)' }} />
                  {g.label}
                </button>
                {open && g.items.map((it) => (
                  <button
                    key={it.id}
                    onClick={() => setSelected(it.id)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '5px 8px 5px 32px', fontSize: 12,
                      background: selected === it.id ? 'var(--hover)' : 'transparent',
                      border: 'none', borderRadius: 5, cursor: 'pointer',
                      color: selected === it.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                    }}
                  >
                    {it.label}
                  </button>
                ))}
              </div>
            );
          })}
          {visibleGroups.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
              无匹配设置
            </div>
          )}
        </div>
      </aside>

      {/* 内容区 */}
      <section style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '18px 22px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          marginBottom: 18, paddingBottom: 12, borderBottom: '1px solid var(--border)',
        }}>
          <Settings size={15} style={{ color: 'var(--text-muted)' }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{activeLabel}</span>
        </div>
        <div style={{ maxWidth: 560 }}>{renderPage()}</div>
      </section>
    </div>
  );
}

// ── 通用字段包装 ──

function Field({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>{title}</div>
      {description && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10 }}>{description}</div>
      )}
      <div style={{ marginTop: description ? 0 : 8 }}>{children}</div>
    </div>
  );
}

// ── 开关（AI 行为页用） ──

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      data-subtle
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      style={{
        width: 34, height: 19, borderRadius: 10, border: 'none', cursor: 'pointer',
        background: on ? 'var(--accent)' : 'var(--hover)', position: 'relative', flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute', top: 2, left: on ? 17 : 2, width: 15, height: 15,
          borderRadius: '50%', transition: 'left 0.12s ease',
          background: on ? '#0d0d0d' : 'var(--text-muted)',
        }}
      />
    </button>
  );
}

// ── 模型配置页（多模型 profile） ──

const PROVIDERS: { id: ProviderKind; label: string }[] = [
  { id: 'openai-compatible', label: 'OpenAI 兼容' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'gemini', label: 'Gemini' },
];

/** 提交模型列表的落库助手（Rust 侧会兜底保证至少一个 + active 有效）。 */
function commitModels(next: ModelProfile[], activeId: string) {
  setAiModels(next, activeId).catch((e) =>
    useToastStore.getState().addToast(String((e as Error)?.message ?? e), 'error'),
  );
}

function AiModelPage() {
  const aiCfg = useAiConfigStore();
  const [keyDraft, setKeyDraft] = useState('');
  const provider = aiCfg.provider;
  const keySet =
    provider === 'anthropic' ? aiCfg.hasAnthropicKey
    : provider === 'gemini' ? aiCfg.hasGeminiKey
    : aiCfg.hasKey;
  const toast = (msg: string, type: 'info' | 'success' | 'error') =>
    useToastStore.getState().addToast(msg, type);

  const commitKey = () => {
    const k = keyDraft.trim();
    if (!k) return;
    setProviderKey(provider, k)
      .then(() => { setKeyDraft(''); toast('已保存 API Key', 'success'); })
      .catch((e) => toast(String((e as Error)?.message ?? e), 'error'));
  };

  return (
    <>
      <Field
        title="服务商 API Key"
        description="Key 按服务商共用：同一服务商下的多个模型复用同一个 Key。仅保存在本机后端，界面不回显明文。此处显示「当前模型」所在服务商。"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{
            fontSize: 11, padding: '2px 8px', borderRadius: 4,
            color: keySet ? 'var(--success)' : 'var(--text-muted)',
            background: keySet ? 'var(--success-bg)' : 'var(--hover)',
          }}>
            {keySet ? '已配置' : '未配置'}
          </span>
          {keySet && (
            <button
              onClick={() => clearProviderKey(provider).then(() => toast('已清除 API Key', 'success'))}
              style={btnStyle}
            >
              清除
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="password"
            value={keyDraft}
            placeholder={keySet ? '输入以覆盖（留空不改动）' : '输入 API Key'}
            onChange={(e) => setKeyDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitKey(); }}
            style={inputStyle}
          />
          <button
            onClick={commitKey}
            style={{ ...btnStyle, background: 'var(--accent)', color: '#0d0d0d', border: 'none', flexShrink: 0 }}
          >
            保存
          </button>
        </div>
      </Field>

      <ModelListField />
    </>
  );
}

function ModelListField() {
  const models = useAiConfigStore((s) => s.models);
  const activeId = useAiConfigStore((s) => s.activeModel);
  const toast = (msg: string, type: 'info' | 'success' | 'error') =>
    useToastStore.getState().addToast(msg, type);

  const update = (id: string, patch: Partial<ModelProfile>) =>
    commitModels(models.map((m) => (m.id === id ? { ...m, ...patch } : m)), activeId);

  const remove = (id: string) => {
    if (models.length <= 1) {
      toast('至少保留一个模型', 'info');
      return;
    }
    const next = models.filter((m) => m.id !== id);
    const nextActive = id === activeId ? next[0]!.id : activeId;
    commitModels(next, nextActive);
  };

  const add = () => {
    const id = `m${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    commitModels(
      [
        ...models,
        {
          id,
          name: `模型 ${models.length + 1}`,
          provider: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          model: '',
        },
      ],
      activeId,
    );
  };

  return (
    <Field
      title="模型列表"
      description="配置多个模型，每个模型独立服务商 / 服务地址 / 模型名；点「设为当前」切换生效。API Key 按服务商共用。"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {models.map((m) => (
          <div
            key={m.id}
            style={{
              border: '1px solid var(--border)', borderRadius: 'var(--radius-inner)',
              padding: '10px 12px', background: 'var(--canvas)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ModelTextInput
                value={m.name}
                placeholder="模型名称"
                onCommit={(v) => update(m.id, { name: v })}
                style={{ flex: 1, fontWeight: 600 }}
              />
              {m.id === activeId ? (
                <span style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 4, flexShrink: 0,
                  color: 'var(--success)', background: 'var(--success-bg)',
                }}>
                  当前
                </span>
              ) : (
                <button data-subtle onClick={() => void setActiveModel(m.id)} style={btnStyle}>
                  设为当前
                </button>
              )}
              <button
                data-subtle
                onClick={() => remove(m.id)}
                title="删除模型"
                style={{
                  width: 24, height: 24, flexShrink: 0, display: 'inline-flex',
                  alignItems: 'center', justifyContent: 'center',
                  border: '1px solid transparent', borderRadius: 4, background: 'transparent',
                  color: 'var(--text-muted)', cursor: 'pointer',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-light)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
              >
                <X size={13} />
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <Segmented
                options={PROVIDERS.map((p) => ({ value: p.id, label: p.label }))}
                value={m.provider}
                onChange={(v) => update(m.id, { provider: v })}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <ModelTextInput
                value={m.baseUrl}
                placeholder="服务地址 (Base URL)"
                onCommit={(v) => update(m.id, { baseUrl: v })}
                style={{ flex: 1 }}
              />
              <ModelTextInput
                value={m.model}
                placeholder="模型 ID"
                onCommit={(v) => update(m.id, { model: v })}
                style={{ flex: 1 }}
              />
            </div>
          </div>
        ))}
        <button
          data-subtle
          onClick={add}
          style={{ ...btnStyle, display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}
        >
          <Plus size={12} /> 添加模型
        </button>
      </div>
    </Field>
  );
}

// ── AI 行为页（全局默认 + 每模型覆盖） ──

function AiBehaviorPage() {
  const models = useAiConfigStore((s) => s.models);
  const agentSettings = useAgentSettings();
  const [scope, setScope] = useState<string>('global');

  const isGlobal = scope === 'global';
  const model = models.find((m) => m.id === scope) ?? null;
  const eff = agentSettings.resolve(isGlobal ? undefined : scope);
  const overrideKeys = !isGlobal && model ? Object.keys(agentSettings.overrides[model.id] ?? {}) : [];
  const hasOverride = overrideKeys.length > 0;

  const update = (patch: Partial<AgentSettings>) => {
    if (isGlobal) agentSettings.update(patch);
    else if (model) agentSettings.updateModel(model.id, patch as Partial<ModelBehaviorSettings>);
  };

  return (
    <>
      <Field
        title="作用域"
        description="「全局默认」对所有模型生效；选中某个模型可为其单独覆盖行为设置（只覆盖改动项，其余回落全局默认）。"
      >
        <Segmented
          options={[
            { value: 'global', label: '全局默认' },
            ...models.map((m) => ({ value: m.id, label: m.name || m.model })),
          ]}
          value={scope}
          onChange={(v) => setScope(v)}
        />
      </Field>

      {!isGlobal && model && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 10px', marginBottom: 8, borderRadius: 'var(--radius-inner)',
          background: hasOverride ? 'var(--accent-warm-dim)' : 'var(--hover)',
          fontSize: 11, color: hasOverride ? 'var(--accent-warm)' : 'var(--text-muted)',
        }}>
          <span>{hasOverride ? `已覆盖 ${overrideKeys.length} 项` : '跟随全局默认'}</span>
          <div style={{ flex: 1 }} />
          {hasOverride && (
            <button data-subtle onClick={() => agentSettings.resetModel(model.id)} style={btnStyle}>
              重置为全局默认
            </button>
          )}
        </div>
      )}

      <Field title="Agent 模式" description="开启后 AI 可以调用工具（执行命令、读写文件、搜索等，逐项权限在「AI 权限」页管理）；关闭为纯聊天。">
        <Toggle on={eff.agentMode} onChange={(v) => update({ agentMode: v })} />
      </Field>
      <Field title="联网搜索" description="Anthropic / Gemini 使用服务商原生搜索；OpenAI 兼容服务走 Tavily 兜底（在「网络搜索」页配置 Key）。">
        <Toggle on={eff.webSearch} onChange={(v) => update({ webSearch: v })} />
      </Field>
      <Field title="深度思考" description="提高推理强度（reasoning effort / thinking budget）；响应更慢，适合复杂问题。">
        <Toggle on={eff.deepThink} onChange={(v) => update({ deepThink: v })} />
      </Field>
      <Field title="最大迭代步数" description="Agent 一次回答最多调用多少轮工具；1–20。">
        <NumberInput value={eff.maxSteps} min={1} max={20} onChange={(v) => update({ maxSteps: v })} />
      </Field>
      <Field title="上下文消息数" description="发送给模型的最近消息条数；0 = 不裁剪（全量）。">
        <NumberInput value={eff.contextMessages} min={0} max={500} onChange={(v) => update({ contextMessages: v })} />
      </Field>
      <Field title="回复 Token 上限" description="单次回复的最大 token 数；0 = 使用服务商默认（Anthropic 深度思考时自动抬到 16000）。">
        <NumberInput value={eff.maxOutputTokens} min={0} max={32768} onChange={(v) => update({ maxOutputTokens: v })} />
      </Field>
      <Field title="采样温度" description="控制输出随机性；关闭 = 使用服务商默认。">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Toggle on={eff.temperature != null} onChange={(v) => update({ temperature: v ? 0.7 : null })} />
          {eff.temperature != null && (
            <input
              type="number"
              step={0.1}
              min={0}
              max={2}
              value={eff.temperature}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) update({ temperature: Math.min(2, Math.max(0, n)) });
              }}
              style={{ ...inputStyle, width: 100 }}
            />
          )}
        </div>
      </Field>

      {isGlobal && (
        <>
          <Field title="智能会话标题" description="内容足够概括时才自动生成标题（不是建会话就生成）；手动改过的名字不会被覆盖。">
            <Toggle on={eff.autoTitle} onChange={(v) => update({ autoTitle: v })} />
          </Field>
          <Field title="标题模型" description="生成标题用的模型；留空 = 沿用聊天模型。">
            <input
              value={eff.titleModel}
              placeholder="沿用聊天模型"
              onChange={(e) => update({ titleModel: e.target.value })}
              style={inputStyle}
            />
          </Field>
          <Field title="命令自动补全" description="在终端输入命令时给出补全建议（Tab 接受，Esc 丢弃）；没有配置 AI 时仍有本地历史/路径补全。">
            <Toggle on={eff.completeEnabled} onChange={(v) => update({ completeEnabled: v })} />
          </Field>
          <Field title="补全防抖（毫秒）" description="停顿多久后触发补全；100–2000。">
            <NumberInput value={eff.completeDebounceMs} min={100} max={2000} onChange={(v) => update({ completeDebounceMs: v })} />
          </Field>
          <Field title="补全模型" description="AI 增强补全用的模型；留空 = 沿用聊天模型。">
            <input
              value={eff.completeModel}
              placeholder="沿用聊天模型"
              onChange={(e) => update({ completeModel: e.target.value })}
              style={inputStyle}
            />
          </Field>
        </>
      )}
    </>
  );
}

// ── 模型字段 / 数字输入 ──

function ModelTextInput({ value, onCommit, placeholder, style }: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { const v = draft.trim(); if (v !== value) onCommit(v); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      style={{ ...inputStyle, ...style }}
    />
  );
}

function NumberInput({ value, onChange, min, max }: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => {
        const n = Math.round(Number(e.target.value));
        if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
      }}
      style={{ ...inputStyle, width: 120 }}
    />
  );
}

// ── 主题页 ──

function ThemePage() {
  const { mode, setMode } = useTheme();
  return (
    <Field title="主题" description="选择界面明暗外观。">
      <div style={{ display: 'flex', gap: 8 }}>
        {(['dark', 'light'] as const).map((m) => {
          const active = mode === m;
          const Icon = m === 'dark' ? Moon : Sun;
          return (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 16px', fontSize: 12, cursor: 'pointer',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 'var(--radius-inner)', background: active ? 'var(--hover)' : 'transparent',
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              <Icon size={14} /> {m === 'dark' ? '深色' : '浅色'}
            </button>
          );
        })}
      </div>
    </Field>
  );
}

// ── 快捷键说明页 ──

const SHORTCUTS: { keys: string[]; desc: string }[] = [
  { keys: ['⌘T'], desc: '新建标签页' },
  { keys: ['⌘⇧T'], desc: '撤销关闭标签' },
  { keys: ['⌘W'], desc: '关闭标签页' },
  { keys: ['⌘1–9'], desc: '切换到第 N 个标签' },
  { keys: ['⌘D'], desc: '分裂终端（选择落点，继承类型）' },
  { keys: ['⌘⇧D'], desc: '直接上下分裂（跳过落点选择）' },
  { keys: ['⌥⌘D'], desc: '选择类型后分裂（混搭 local/ssh）' },
  { keys: ['⌘]', '⌘['], desc: '在窗口内终端间切换焦点' },
  { keys: ['⌘F'], desc: '全局搜索' },
  { keys: ['⌘P'], desc: '命令面板' },
  { keys: ['⌘,'], desc: '打开设置' },
  { keys: ['⌘+', '⌘-', '⌘0'], desc: '放大 / 缩小 / 重置终端字号' },
  { keys: ['Ctrl+Shift+B'], desc: '切换书签' },
  { keys: ['Esc'], desc: '切回命令输入栏' },
];

function ShortcutPage() {
  return (
    <Field title="快捷键说明" description="当前支持的键盘快捷键（macOS 下 ⌘ = Command）。拖拽侧栏标签到终端区域可停靠/调整位置（最多 2×2 四个终端）。">
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 4,
        border: '1px solid var(--border)', borderRadius: 'var(--radius-inner)',
        overflow: 'hidden',
      }}>
        {SHORTCUTS.map((s, i) => (
          <div
            key={i}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
              padding: '8px 12px',
              background: i % 2 === 0 ? 'transparent' : 'var(--hover)',
              fontSize: 12,
            }}
          >
            <span style={{ color: 'var(--text-secondary)' }}>{s.desc}</span>
            <span style={{ display: 'inline-flex', gap: 4, flexShrink: 0 }}>
              {s.keys.map((k, j) => (
                <kbd
                  key={j}
                  style={{
                    fontFamily: 'var(--font-mono)', fontSize: 11,
                    padding: '2px 6px', borderRadius: 4,
                    background: 'var(--canvas)', border: '1px solid var(--border)',
                    color: 'var(--text-primary)', whiteSpace: 'nowrap',
                  }}
                >
                  {k}
                </kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
    </Field>
  );
}

// ── 模板列表编辑器（扩展名 → 命令，可增删行） ──

function TemplateListEditor({ value, onChange, placeholder }: {
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  placeholder: string;
}) {
  const [rows, setRows] = useState<{ ext: string; cmd: string }[]>(() =>
    Object.entries(value).map(([ext, cmd]) => ({ ext, cmd })),
  );

  const sync = (next: { ext: string; cmd: string }[]) => {
    setRows(next);
    const obj: Record<string, string> = {};
    for (const r of next) {
      const e = r.ext.trim().toLowerCase().replace(/^\./, '');
      const c = r.cmd.trim();
      if (e && c) obj[e] = c;
    }
    onChange(obj);
  };

  const updateRow = (i: number, patch: Partial<{ ext: string; cmd: string }>) => {
    sync(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };

  return (
    <div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input
            value={r.ext}
            placeholder="扩展名，如 md"
            onChange={(e) => updateRow(i, { ext: e.target.value })}
            style={{ ...inputStyle, width: 120, flexShrink: 0 }}
          />
          <input
            value={r.cmd}
            placeholder={placeholder}
            onChange={(e) => updateRow(i, { cmd: e.target.value })}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            onClick={() => sync(rows.filter((_, j) => j !== i))}
            title="删除此行"
            style={{
              width: 26, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid transparent', borderRadius: 4, background: 'transparent',
              color: 'var(--text-muted)', cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-light)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            <X size={13} />
          </button>
        </div>
      ))}
      <button
        onClick={() => sync([...rows, { ext: '', cmd: '' }])}
        style={{ ...btnStyle, display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        <Plus size={12} /> 添加
      </button>
    </div>
  );
}
