/**
 * SkillsSettings — 技能设置页（文件夹式技能 + 安全模型）。
 *
 * 列表行 + 详情面板（内嵌文件树浏览，复用现有文件系统交互），导入支持 URL/文件夹/压缩包。
 * 信任分级：未信任/已信任 + 启用/禁用；含脚本/来源/已修改 徽标；导入默认未信任。
 */

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Download, FileText, Folder, ShieldAlert, Store, Trash2, X } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { fileOpenWith } from '../files/fs';
import {
  listSkills, getSkill, removeSkill, installSkillMd, fetchRemoteSkills, importSkillsFromPath,
  setSkillState, readSkillFile, marketGithubList, marketGithubInstall,
  type SkillMeta, type SkillDetail, type MarketSkill,
} from '../agent/skills';
import { useToastStore } from '../components/Toast';

const toast = (msg: string, type: 'info' | 'success' | 'error') =>
  useToastStore.getState().addToast(msg, type);

/** 预置技能市场（GitHub 仓库，含 SKILL.md 的常见技能库） */
const MARKETPLACES: { name: string; repo: string }[] = [
  { name: 'anthropics/skills', repo: 'anthropics/skills' },
  { name: 'agentskills/agentskills', repo: 'agentskills/agentskills' },
  { name: 'magnus919/agent-skills', repo: 'magnus919/agent-skills' },
];

// ── 样式 ──

const btn: React.CSSProperties = {
  padding: '4px 10px', fontSize: 12, border: '1px solid var(--border)',
  borderRadius: 'var(--radius-inner)', background: 'transparent',
  color: 'var(--text-secondary)', cursor: 'pointer',
};

const input: React.CSSProperties = {
  background: 'var(--canvas)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-inner)', padding: '6px 8px', fontSize: 12,
  color: 'var(--text-primary)', outline: 'none', flex: 1,
  fontFamily: 'var(--font-mono)', boxSizing: 'border-box',
};

function Badge({ text, tone }: { text: string; tone: 'warn' | 'muted' | 'ok' | 'danger' }) {
  const color =
    tone === 'warn' ? 'var(--accent-warm)'
    : tone === 'ok' ? 'var(--success)'
    : tone === 'danger' ? 'var(--error-light)'
    : 'var(--text-muted)';
  const bg =
    tone === 'warn' ? 'var(--accent-warm-dim)'
    : tone === 'ok' ? 'var(--success-bg)'
    : tone === 'danger' ? 'var(--error-bg)'
    : 'var(--hover)';
  return <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, color, background: bg, flexShrink: 0 }}>{text}</span>;
}

// ── 文件树（从扁平相对路径构建） ──

interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileNode[];
}

function buildFileTree(files: string[]): FileNode[] {
  const root: FileNode[] = [];
  const map = new Map<string, FileNode>();
  for (const f of files) {
    const parts = f.split('/');
    let cur = root;
    let curPath = '';
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]!;
      curPath = curPath ? `${curPath}/${p}` : p;
      const isDir = i < parts.length - 1;
      let node = map.get(curPath);
      if (!node) {
        node = { name: p, path: curPath, isDir, children: isDir ? [] : undefined };
        map.set(curPath, node);
        cur.push(node);
      }
      cur = node.children ?? [];
    }
  }
  return root;
}

function SkillFileBrowser({ skillName, files }: { skillName: string; files: string[] }) {
  const tree = useMemo(() => buildFileTree(files), [files]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');

  const pick = async (node: FileNode) => {
    if (node.isDir) {
      setOpen((prev) => {
        const next = new Set(prev);
        if (next.has(node.path)) next.delete(node.path);
        else next.add(node.path);
        return next;
      });
      return;
    }
    setSelected(node.path);
    try {
      setContent(await readSkillFile(skillName, node.path));
    } catch (e) {
      setContent(`读取失败：${(e as Error)?.message ?? e}`);
    }
  };

  const render = (nodes: FileNode[], depth: number): React.ReactNode =>
    nodes.map((n) => (
      <div key={n.path}>
        <div
          onClick={() => void pick(n)}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: `2px 8px 2px ${8 + depth * 14}px`, fontSize: 12,
            cursor: 'pointer', color: n.isDir ? 'var(--text-primary)' : 'var(--text-secondary)',
            background: selected === n.path ? 'var(--hover)' : 'transparent',
          }}
        >
          {n.isDir ? (
            <>
              <ChevronRight size={11} style={{ transform: open.has(n.path) ? 'rotate(90deg)' : 'none', transition: 'transform 0.1s' }} />
              <Folder size={12} />
            </>
          ) : (
            <FileText size={12} style={{ marginLeft: 11 }} />
          )}
          <span style={{ fontFamily: n.isDir ? 'var(--font-ui)' : 'var(--font-mono)' }}>{n.name}</span>
        </div>
        {n.isDir && open.has(n.path) && n.children && render(n.children, depth + 1)}
      </div>
    ));

  if (files.length === 0) {
    return <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: 8 }}>仅 SKILL.md，无其他文件</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-inner)', overflow: 'auto', maxHeight: 180 }}>
        {render(tree, 0)}
      </div>
      {selected && (
        <pre style={{
          margin: 0, padding: '8px 10px', maxHeight: 180, overflow: 'auto',
          background: 'var(--hover)', borderRadius: 'var(--radius-inner)',
          fontSize: 11, fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          color: 'var(--text-secondary)',
        }}>
          {content}
        </pre>
      )}
    </div>
  );
}

// ── 详情面板 ──

function SkillDetailPanel({ skill, onClose, onChanged }: {
  skill: SkillDetail;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toggleTrust = async () => {
    await setSkillState(skill.name, !skill.trusted, undefined);
    onChanged();
  };
  const toggleEnabled = async () => {
    await setSkillState(skill.name, undefined, !skill.enabled);
    onChanged();
  };
  const del = async () => {
    await removeSkill(skill.name);
    toast(`已删除 ${skill.name}`, 'success');
    onChanged();
    onClose();
  };
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 30, background: 'var(--surface)',
      display: 'flex', flexDirection: 'column', overflow: 'auto', padding: '14px 18px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <button onClick={onClose} style={{ ...btn }}>← 返回</button>
        <div style={{ flex: 1 }} />
        <button onClick={() => void fileOpenWith(skill.dir)} style={btn}>打开文件夹</button>
        <button onClick={() => void toggleTrust()} style={btn}>
          {skill.trusted ? '取消信任' : '信任'}
        </button>
        <button onClick={() => void toggleEnabled()} style={btn}>
          {skill.enabled ? '禁用' : '启用'}
        </button>
        <button onClick={() => void del()} style={{ ...btn, color: 'var(--error-light)' }}>删除</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{skill.name}</span>
        {skill.trusted ? <Badge text="已信任" tone="ok" /> : <Badge text="未信任" tone="warn" />}
        {!skill.enabled && <Badge text="已禁用" tone="muted" />}
        {skill.hasScripts && <Badge text="含脚本" tone="danger" />}
        {skill.modified && <Badge text="已修改" tone="warn" />}
        <Badge text={skill.source || '本地'} tone="muted" />
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
        {skill.description || '无描述'}
      </div>
      {skill.allowedTools && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
          允许工具：<span style={{ fontFamily: 'var(--font-mono)' }}>{skill.allowedTools}</span>
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 6, wordBreak: 'break-all' }}>
        {skill.dir}
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>文件</div>
        <SkillFileBrowser skillName={skill.name} files={skill.files} />
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>SKILL.md</div>
        <pre style={{
          margin: 0, padding: '8px 10px', maxHeight: 240, overflow: 'auto',
          background: 'var(--hover)', borderRadius: 'var(--radius-inner)',
          fontSize: 11, fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          color: 'var(--text-secondary)',
        }}>
          {skill.prompt || '正文为空'}
        </pre>
      </div>
    </div>
  );
}

// ── 技能市场（弹层页面） ──

function SkillMarketplacePanel({ metas, onClose, onInstalled }: {
  metas: SkillMeta[];
  onClose: () => void;
  onInstalled: () => void;
}) {
  const [repo, setRepo] = useState('');
  const [remote, setRemote] = useState<MarketSkill[]>([]);
  const [browsing, setBrowsing] = useState(false);
  const [installing, setInstalling] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  const browse = async () => {
    const r = repo.trim();
    if (!r) return;
    setBrowsing(true);
    try {
      const list = await marketGithubList(r);
      setRemote(list);
      if (list.length === 0) toast('仓库中未找到技能', 'info');
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    } finally {
      setBrowsing(false);
    }
  };

  const install = async (r: MarketSkill) => {
    setInstalling((s) => new Set(s).add(r.name));
    try {
      await marketGithubInstall(repo.trim(), r.dir);
      toast(`已安装 ${r.name}`, 'success');
      onInstalled();
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    } finally {
      setInstalling((s) => { const n = new Set(s); n.delete(r.name); return n; });
    }
  };

  const q = query.trim().toLowerCase();
  const visible = q ? remote.filter((r) => r.name.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q)) : remote;

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 30, background: 'var(--surface)',
      display: 'flex', flexDirection: 'column', padding: '14px 18px', overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <button onClick={onClose} style={{ ...btn }}>← 返回</button>
        <span style={{ fontSize: 14, fontWeight: 600 }}>技能市场</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>第三方技能默认未信任，安装后可查看来源再信任</span>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <select
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          style={{ ...input, flexShrink: 0, width: 170, appearance: 'none', cursor: 'pointer' }}
        >
          <option value="">自定义…</option>
          {MARKETPLACES.map((m) => <option key={m.repo} value={m.repo}>{m.name}</option>)}
        </select>
        <input
          value={repo}
          placeholder="GitHub 仓库，如 anthropics/skills"
          onChange={(e) => setRepo(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void browse(); }}
          style={input}
        />
        <button onClick={() => void browse()} disabled={browsing} style={{ ...btn, flexShrink: 0 }}>
          {browsing ? '加载中…' : '浏览'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          value={query}
          placeholder="搜索技能…"
          onChange={(e) => setQuery(e.target.value)}
          style={input}
        />
        <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center', flexShrink: 0 }}>
          {remote.length > 0 ? `共 ${remote.length} 个` : ''}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {remote.length === 0 && !browsing && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>
            选择 GitHub 仓库并点「浏览」加载技能列表。
          </div>
        )}
        {visible.map((r) => {
          const installed = metas.some((m) => m.name === r.name);
          return (
            <div key={r.name} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-inner)', padding: '8px 12px', background: 'var(--canvas)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  {r.name}
                  <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> · {r.dir}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{r.description || '无描述'}</div>
              </div>
              {installed ? (
                <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 4, color: 'var(--success)', background: 'var(--success-bg)', flexShrink: 0 }}>已安装</span>
              ) : (
                <button onClick={() => void install(r)} disabled={installing.has(r.name)} style={{ ...btn, flexShrink: 0 }}>
                  {installing.has(r.name) ? '安装中…' : '安装'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 主页面 ──

export default function SkillsSettings() {
  const [metas, setMetas] = useState<SkillMeta[]>([]);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [warnDismissed, setWarnDismissed] = useState(false);
  const [market, setMarket] = useState(false);

  const refresh = () => {
    listSkills().then(setMetas).catch((e) => toast(String((e as Error)?.message ?? e), 'error'));
  };
  useEffect(() => { refresh(); }, []);

  const openDetail = async (name: string) => {
    try {
      setDetail(await getSkill(name));
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    }
  };

  const doImportUrl = async () => {
    const url = importUrl.trim();
    if (!url) return;
    setImporting(true);
    try {
      const remote = await fetchRemoteSkills(url);
      if (remote.length === 0) { toast('清单为空', 'info'); return; }
      for (const r of remote) await installSkillMd(r.name, r.description, r.prompt);
      toast(`已安装 ${remote.length} 个技能`, 'success');
      setImportUrl('');
      refresh();
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    } finally {
      setImporting(false);
    }
  };

  const doImportPath = async (directory: boolean) => {
    try {
      const sel = await openDialog({ multiple: false, directory });
      if (typeof sel !== 'string') return;
      setImporting(true);
      try {
        const imported = await importSkillsFromPath(sel);
        toast(`已导入 ${imported.length} 个技能`, 'success');
        refresh();
      } finally {
        setImporting(false);
      }
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    }
  };

  const toggleTrust = async (m: SkillMeta) => {
    await setSkillState(m.name, !m.trusted, undefined);
    refresh();
  };
  const toggleEnabled = async (m: SkillMeta) => {
    await setSkillState(m.name, undefined, !m.enabled);
    refresh();
  };
  const del = async (name: string) => {
    await removeSkill(name);
    toast(`已删除 ${name}`, 'success');
    refresh();
  };

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {!warnDismissed && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 10px', borderRadius: 'var(--radius-inner)',
          background: 'var(--accent-warm-dim)', fontSize: 11, lineHeight: 1.5, color: 'var(--accent-warm)',
        }}>
          <ShieldAlert size={14} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>技能可能包含脚本，启用即信任其内容；脚本执行仍受 AI 权限管控。导入的第三方技能默认未信任。</span>
          <button
            onClick={() => setWarnDismissed(true)}
            title="关闭"
            style={{ border: 'none', background: 'transparent', color: 'var(--accent-warm)', cursor: 'pointer', padding: 2, display: 'inline-flex' }}
          >
            <X size={13} />
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={importUrl}
          placeholder="从 URL 导入技能清单"
          onChange={(e) => setImportUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void doImportUrl(); }}
          style={input}
        />
        <button onClick={() => void doImportUrl()} disabled={importing} style={{ ...btn, flexShrink: 0 }}>
          {importing ? '导入中…' : '导入'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => void doImportPath(true)} disabled={importing} style={{ ...btn, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Download size={13} /> 导入文件夹
        </button>
        <button onClick={() => void doImportPath(false)} disabled={importing} style={{ ...btn, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Download size={13} /> 导入压缩包
        </button>
        <button onClick={() => setMarket(true)} style={{ ...btn, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Store size={13} /> 技能市场
        </button>
      </div>

      {market && (
        <SkillMarketplacePanel
          metas={metas}
          onClose={() => setMarket(false)}
          onInstalled={refresh}
        />
      )}

      {metas.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 0' }}>
          还没有技能，可从 URL、文件夹或压缩包导入。
        </div>
      )}

      {metas.map((m) => (
        <div
          key={m.name}
          onClick={() => void openDetail(m.name)}
          style={{
            border: '1px solid var(--border)', borderRadius: 'var(--radius-inner)',
            padding: '8px 12px', background: 'var(--canvas)', cursor: 'pointer',
            opacity: m.enabled ? 1 : 0.55,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{m.name}</span>
            {m.trusted ? <Badge text="已信任" tone="ok" /> : <Badge text="未信任" tone="warn" />}
            {!m.enabled && <Badge text="禁用" tone="muted" />}
            {m.hasScripts && <Badge text="含脚本" tone="danger" />}
            {m.modified && <Badge text="已修改" tone="warn" />}
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.source || '本地'}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.files.length} 个文件</span>
            <div style={{ flex: 1 }} />
            <button onClick={(e) => { e.stopPropagation(); void toggleTrust(m); }} style={btn}>
              {m.trusted ? '取消信任' : '信任'}
            </button>
            <button onClick={(e) => { e.stopPropagation(); void toggleEnabled(m); }} style={btn}>
              {m.enabled ? '禁用' : '启用'}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); void del(m.name); }}
              title="删除技能"
              style={{ width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid transparent', borderRadius: 4, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-light)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
            >
              <Trash2 size={13} />
            </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
            {m.description || '无描述'}
          </div>
        </div>
      ))}

      {detail && (
        <SkillDetailPanel skill={detail} onClose={() => setDetail(null)} onChanged={refresh} />
      )}
    </div>
  );
}
