import { OutlineButton } from '@ui/actions/OutlineButton';
import { t } from '@i18n';
import { IconButton } from '@ui/actions/IconButton';
import { TextInput } from '@ui/fields/TextInput';
/**
 * SkillsSettings — 技能设置页（文件夹式技能 + 安全模型）。
 *
 * 列表行 + 详情面板（内嵌文件树浏览，复用现有文件系统交互），导入支持 URL/文件夹/压缩包。
 * 信任分级：未信任/已信任 + 启用/禁用；含脚本/来源/已修改 徽标；导入默认未信任。
 */

import { useState } from 'react';
import { ArrowLeft, ChevronRight, Download, FileText, Folder, ShieldAlert, Store, Trash2, X } from '@ui/icons';
import { fileOpenWith } from '@platform/api/fs';
import {
  setSkillState, removeSkill,
  type SkillMeta, type SkillDetail,
} from '@features/agent/services/skills';
import { useToastStore } from '@ui/feedback/Toast';
import Select from '@ui/fields/Select';
import ErrorBox from '@ui/feedback/ErrorBox';
import { useSkillsSettings } from '@features/settings/hooks/useSkillsSettings';
import { useSkillMarketplace } from '@features/settings/hooks/useSkillMarketplace';
import { useSkillFileBrowser } from '@features/settings/hooks/useSkillFileBrowser';
import type { FileNode } from '@features/settings/model/skillFileTree';
import { SettingsGroup } from '../components/ui';
import { inputStyle } from '../components/formStyles';

const toast = (msg: string, type: 'info' | 'success' | 'error') =>
  useToastStore.getState().addToast(msg, type);

/** 预置技能市场（GitHub 仓库 URL，含 SKILL.md 的常见技能库） */
const MARKETPLACES: { name: string; repo: string }[] = [
  { name: 'anthropics/skills', repo: 'https://github.com/anthropics/skills' },
  { name: 'magnus919/agent-skills', repo: 'https://github.com/magnus919/agent-skills' },
];


// ── 样式 ──

const btn: React.CSSProperties = {
  padding: '4px 10px',
};

const input: React.CSSProperties = { ...inputStyle, width: 'auto', flex: 1 };

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
  return <span style={{ fontSize: 'calc(10px * var(--ui-font-scale))', padding: '1px 6px', borderRadius: 4, color, background: bg, flexShrink: 0 }}>{text}</span>;
}

function SkillFileBrowser({ skillName, files }: { skillName: string; files: string[] }) {
  const { tree, open, selected, content, error, pick, reload } = useSkillFileBrowser({ skillName, files });

  const render = (nodes: FileNode[], depth: number): React.ReactNode =>
    nodes.map((n) => (
      <div key={n.path}>
        <div
          onClick={() => void pick(n)}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: `2px 8px 2px ${8 + depth * 14}px`, fontSize: 'calc(12px * var(--ui-font-scale))',
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
          <span style={{ fontFamily: n.isDir ? 'var(--font-ui)' : 'var(--font-ui)' }}>{n.name}</span>
        </div>
        {n.isDir && open.has(n.path) && n.children && render(n.children, depth + 1)}
      </div>
    ));

  if (files.length === 0) {
    return <div style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)', padding: 8 }}>{t('Only SKILL.md, no other files')}</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ borderRadius: 'var(--radius-inner)', overflow: 'auto', maxHeight: 180, background: 'var(--surface)' }}>
        {render(tree, 0)}
      </div>
      {selected && (error ? (
        <ErrorBox actions={<button onClick={reload} style={{ minHeight: 32 }}>{t('Retry')}</button>}>
          {error}
        </ErrorBox>
      ) : (
        <pre style={{
          margin: 0, padding: '8px 10px', maxHeight: 180, overflow: 'auto',
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-inner)',
          fontSize: 'calc(11px * var(--ui-font-scale))', fontFamily: 'var(--font-ui)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          color: 'var(--text-secondary)',
        }}>
          {content}
        </pre>
      ))}
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
        <OutlineButton onClick={onClose}><ArrowLeft size={16} aria-hidden="true" />{t('Back')}</OutlineButton>
        <div style={{ flex: 1 }} />
        <OutlineButton onClick={() => void fileOpenWith(skill.dir)} style={btn}>打开文件夹</OutlineButton>
        <OutlineButton onClick={() => void toggleTrust()} style={btn}>
          {skill.trusted ? '取消信任' : '信任'}
        </OutlineButton>
        <OutlineButton onClick={() => void toggleEnabled()} style={btn}>
          {skill.enabled ? '禁用' : '启用'}
        </OutlineButton>
        <OutlineButton onClick={() => void del()} style={{ ...btn, color: 'var(--control-danger-color)' }}>{t('Delete')}</OutlineButton>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'calc(14px * var(--ui-font-scale))', fontWeight: 'var(--fw-semibold)' }}>{skill.name}</span>
        {skill.trusted ? <Badge text="已信任" tone="ok" /> : <Badge text="未信任" tone="warn" />}
        {!skill.enabled && <Badge text="已禁用" tone="muted" />}
        {skill.hasScripts && <Badge text="含脚本" tone="danger" />}
        {skill.modified && <Badge text="已修改" tone="warn" />}
        <Badge text={skill.source || '本地'} tone="muted" />
      </div>

      <div style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-secondary)', marginTop: 8 }}>
        {skill.description || '无描述'}
      </div>
      {skill.allowedTools && (
        <div style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)', marginTop: 6 }}>
          允许工具：<span style={{ fontFamily: 'var(--font-ui)' }}>{skill.allowedTools}</span>
        </div>
      )}
      <div style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)', fontFamily: 'var(--font-ui)', marginTop: 6, wordBreak: 'break-all' }}>
        {skill.dir}
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 'calc(12px * var(--ui-font-scale))', fontWeight: 'var(--fw-semibold)', marginBottom: 6 }}>文件</div>
        <SkillFileBrowser skillName={skill.name} files={skill.files} />
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 'calc(12px * var(--ui-font-scale))', fontWeight: 'var(--fw-semibold)', marginBottom: 6 }}>SKILL.md</div>
        <pre style={{
          margin: 0, padding: '8px 10px', maxHeight: 240, overflow: 'auto',
          background: 'var(--hover)', borderRadius: 'var(--radius-inner)',
          fontSize: 'calc(11px * var(--ui-font-scale))', fontFamily: 'var(--font-ui)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
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
  const { repo, remote, browsing, error, changeRepo, browse, install, isInstalling } = useSkillMarketplace(MARKETPLACES[0].repo, onInstalled);
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const visible = q ? remote.filter((r) => r.name.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q)) : remote;

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 30, background: 'var(--surface)',
      display: 'flex', flexDirection: 'column', padding: '14px 18px', overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <OutlineButton onClick={onClose}><ArrowLeft size={16} aria-hidden="true" />{t('Back')}</OutlineButton>
        <span style={{ fontSize: 'calc(14px * var(--ui-font-scale))', fontWeight: 'var(--fw-semibold)' }}>{t('Skill marketplace')}</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)' }}>{t('Third-party skills are untrusted until you review and trust them.')}</span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <Select aria-label={t('Skill repository')} value={MARKETPLACES.some(item => item.repo === repo) ? repo : ''}
          options={[{ value: '', label: t('Custom…') }, ...MARKETPLACES.map(item => ({ value: item.repo, label: item.name }))]}
          onChange={value => { changeRepo(value); if (value) void browse(value); }}
          placeholder={t('Custom…')} style={{ flexShrink: 0, width: 190 }} />
        <TextInput
          value={repo}
          aria-label={t('Repository URL')}
          placeholder={t('Repository URL')}
          onChange={(e) => changeRepo(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void browse(); }}
          style={input}
        />
        <OutlineButton onClick={() => void browse()} disabled={browsing} style={{ ...btn, flexShrink: 0 }}>
          {t(browsing ? 'Loading…' : 'Browse')}
        </OutlineButton>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <TextInput
          value={query}
          placeholder={t('Search skills…')}
          onChange={(e) => setQuery(e.target.value)}
          style={input}
        />
        <span style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)', alignSelf: 'center', flexShrink: 0 }}>
          {remote.length > 0 ? t('{{count}} skills', { count: remote.length }) : ''}
        </span>
      </div>

      {error && <ErrorBox title={t('Could not load skills')} details={error} actions={<OutlineButton onClick={() => void browse()}>{t('Retry')}</OutlineButton>} />}
      <div aria-busy={browsing} style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {remote.length === 0 && !browsing && (
          <div style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-muted)', padding: '8px 0' }}>
            {t(error ? 'Choose another repository or retry loading.' : 'No skills found. Choose a repository and browse its skills.')}
          </div>
        )}
        {visible.map((r) => {
          const installed = metas.some((m) => m.name === r.name);
          return (
            <div key={r.dir} style={{ borderRadius: 'var(--radius-inner)', padding: '8px 12px', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'calc(12px * var(--ui-font-scale))', fontWeight: 'var(--fw-semibold)' }}>
                  {r.name}
                  <span style={{ color: 'var(--text-muted)', fontSize: 'calc(11px * var(--ui-font-scale))' }}> · {r.dir}</span>
                </div>
                <div style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-secondary)', marginTop: 2 }}>{r.description || t('No description')}</div>
              </div>
              {installed ? (
                <span style={{ fontSize: 'calc(11px * var(--ui-font-scale))', padding: '2px 10px', borderRadius: 4, color: 'var(--success)', background: 'var(--success-bg)', flexShrink: 0 }}>{t('Installed')}</span>
              ) : (
                <OutlineButton onClick={() => void install(r)} disabled={isInstalling(r)} style={{ ...btn, flexShrink: 0 }}>
                  {t(isInstalling(r) ? 'Installing…' : 'Install')}
                </OutlineButton>
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
  const {
    metas,
    detail,
    importUrl,
    importing,
    warnDismissed,
    market,
    setImportUrl,
    setWarnDismissed,
    setMarket,
    setDetail,
    refresh,
    openDetail,
    doImportUrl,
    doImportPath,
    toggleTrust,
    toggleEnabled,
    del,
  } = useSkillsSettings();

  return (
    <div style={{ position: 'relative' }}>
      <SettingsGroup title={t('Import skills')}><div className="settings-record" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {!warnDismissed && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 10px', borderRadius: 'var(--radius-inner)',
          background: 'var(--accent-warm-dim)', fontSize: 'calc(11px * var(--ui-font-scale))', lineHeight: 1.5, color: 'var(--accent-warm)',
        }}>
          <ShieldAlert size={14} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>技能可能包含脚本，启用即信任其内容；脚本执行仍受 AI 权限管控。导入的第三方技能默认未信任。</span>
          <IconButton compact onClick={() => setWarnDismissed(true)} data-tip={t('Close')} aria-label={t('Close')}><X size={16} /></IconButton>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <TextInput
          value={importUrl}
          placeholder="从 URL 导入技能清单"
          onChange={(e) => setImportUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void doImportUrl(); }}
          style={input}
        />
        <OutlineButton onClick={() => void doImportUrl()} disabled={importing} style={{ ...btn, flexShrink: 0 }}>
          {importing ? '导入中…' : '导入'}
        </OutlineButton>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <OutlineButton onClick={() => void doImportPath(true)} disabled={importing} style={{ ...btn, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Download size={13} /> 导入文件夹
        </OutlineButton>
        <OutlineButton onClick={() => void doImportPath(false)} disabled={importing} style={{ ...btn, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Download size={13} /> 导入压缩包
        </OutlineButton>
        <OutlineButton onClick={() => setMarket(true)} style={{ ...btn, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Store size={13} /> 技能市场
        </OutlineButton>
      </div>

      {market && (
        <SkillMarketplacePanel
          metas={metas}
          onClose={() => setMarket(false)}
          onInstalled={refresh}
        />
      )}

      </div></SettingsGroup>
      <SettingsGroup title={t('Installed skills')}><div className="settings-record-list">
      {metas.length === 0 && (
        <div style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-muted)', padding: '6px 0' }}>
          还没有技能，可从 URL、文件夹或压缩包导入。
        </div>
      )}

      {metas.map((m) => (
        <div
          className="settings-record"
          key={m.name}
          onClick={() => void openDetail(m.name)}
          style={{
            cursor: 'pointer',
            opacity: m.enabled ? 1 : 0.55,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'calc(12px * var(--ui-font-scale))', fontWeight: 'var(--fw-semibold)', color: 'var(--text-primary)' }}>{m.name}</span>
            {m.trusted ? <Badge text="已信任" tone="ok" /> : <Badge text="未信任" tone="warn" />}
            {!m.enabled && <Badge text="禁用" tone="muted" />}
            {m.hasScripts && <Badge text="含脚本" tone="danger" />}
            {m.modified && <Badge text="已修改" tone="warn" />}
            <span style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)' }}>{m.source || '本地'}</span>
            <span style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)' }}>{m.files.length} 个文件</span>
            <div style={{ flex: 1 }} />
            <OutlineButton onClick={(e) => { e.stopPropagation(); void toggleTrust(m); }} style={btn}>
              {m.trusted ? '取消信任' : '信任'}
            </OutlineButton>
            <OutlineButton onClick={(e) => { e.stopPropagation(); void toggleEnabled(m); }} style={btn}>
              {m.enabled ? '禁用' : '启用'}
            </OutlineButton>
            <IconButton compact tone="danger" onClick={(e) => { e.stopPropagation(); void del(m.name); }} data-tip={t('Delete skill')} aria-label={t('Delete skill')}><Trash2 size={16} /></IconButton>
          </div>
          <div style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-secondary)', marginTop: 4 }}>
            {m.description || '无描述'}
          </div>
        </div>
      ))}

      </div></SettingsGroup>
      {detail && (
        <SkillDetailPanel skill={detail} onClose={() => setDetail(null)} onChanged={refresh} />
      )}
    </div>
  );
}
