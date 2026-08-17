import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Search, ChevronRight, Settings, Cpu, FileCode, Palette, Sun, Moon, Plus, X, Keyboard } from 'lucide-react';
import { loadConfig, saveConfig, type FileOpenConfig } from '../files/fileOpen';
import {
  refreshAiConfig, isApiKeyConfigured, getAiBaseUrl, getModel,
  setApiKey, clearApiKey, setAiBaseUrl, setAiModel,
} from '../lib/ai';
import { useTheme } from '../theme/ThemeProvider';
import { useToastStore } from '../components/Toast';

// ── 设置页结构 ──
// 外层 = 按功能划分的组（大菜单，可展开）；内层 = 细分设置页（小菜单）。
// 每个设置页内再放多个相关的具体配置项。

type PageId = 'ai-model' | 'editor-local' | 'editor-remote' | 'appearance-theme' | 'shortcuts';

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
      { id: 'ai-model', label: '模型配置', keywords: ['ai', 'model', 'api', 'key', 'baseurl', '模型', '密钥', '服务地址'] },
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

  // AI 配置（Rust 后端）
  const [hasKey, setHasKey] = useState(() => isApiKeyConfigured());
  const [baseUrl, setBaseUrl] = useState(() => getAiBaseUrl());
  const [model, setModel] = useState(() => getModel());
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const toast = (msg: string, type: 'info' | 'success' | 'error') =>
    useToastStore.getState().addToast(msg, type);

  useEffect(() => {
    refreshAiConfig().then(() => {
      setHasKey(isApiKeyConfigured());
      setBaseUrl(getAiBaseUrl());
      setModel(getModel());
    });
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
        return (
          <>
            <Field title="API Key" description="用于调用所配置 AI 服务的鉴权令牌；仅保存在本机后端，界面不回显明文。">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 4,
                  color: hasKey ? 'var(--success)' : 'var(--text-muted)',
                  background: hasKey ? 'var(--success-bg)' : 'var(--hover)',
                }}>
                  {hasKey ? '已配置' : '未配置'}
                </span>
                {hasKey && (
                  <button
                    onClick={() => clearApiKey().then(() => { setHasKey(false); toast('已清除 API Key', 'success'); })}
                    style={btnStyle}
                  >
                    清除
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="password"
                  value={apiKeyDraft}
                  placeholder={hasKey ? '输入以覆盖（留空不改动）' : '输入 API Key'}
                  onChange={(e) => setApiKeyDraft(e.target.value)}
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

            <Field title="服务地址 (Base URL)" description="OpenAI 兼容接口地址，例如 https://api.openai.com/v1、https://api.deepseek.com/v1。">
              <input
                value={baseUrl}
                placeholder="https://api.openai.com/v1"
                onChange={(e) => setBaseUrl(e.target.value)}
                onBlur={() => setAiBaseUrl(baseUrl).catch((e) => toast(String((e as Error)?.message ?? e), 'error'))}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                style={inputStyle}
              />
            </Field>

            <Field title="模型" description="模型 ID，取决于所选服务；可输入任意兼容模型名。">
              <input
                value={model}
                list="model-presets"
                placeholder="gpt-4o-mini"
                onChange={(e) => setModel(e.target.value)}
                onBlur={() => setAiModel(model).catch((e) => toast(String((e as Error)?.message ?? e), 'error'))}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                style={inputStyle}
              />
              <datalist id="model-presets">
                {['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'deepseek-chat', 'deepseek-reasoner', 'qwen-plus', 'qwen-max', 'moonshot-v1-8k', 'moonshot-v1-32k', 'glm-4-plus', 'claude-sonnet-5', 'claude-opus-4-1'].map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
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

  function commitKey() {
    const k = apiKeyDraft.trim();
    if (!k) return;
    setApiKey(k)
      .then(() => { setHasKey(true); setApiKeyDraft(''); toast('已保存 API Key', 'success'); })
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
  { keys: ['⌘D'], desc: '停靠活跃标签到空槽位' },
  { keys: ['⌘]', '⌘['], desc: '在停靠终端间切换焦点' },
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
