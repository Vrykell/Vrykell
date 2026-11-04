import { OutlineButton } from '@ui/actions/OutlineButton';
import { t } from '@i18n';
import { IconButton } from '@ui/actions/IconButton';
import { TextInput } from '@ui/fields/TextInput';
/**
 * SkillsSettings — skills settings page (folder-style skills + security model).
 *
 * List rows + detail panel (embedded file tree browser reusing the existing file system interactions); imports support URL/folder/archive.
 * Trust levels: untrusted/trusted plus enabled/disabled; badges for scripts/source/modified; imports start untrusted.
 */

import { useState } from 'react';
import { ArrowLeft, ChevronRight, Download, FileText, Folder, ShieldAlert, Store, X, Plus, Search } from '@ui/icons';
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
import SettingsDialog from '../components/SettingsDialog';
import { inputStyle } from '../components/formStyles';
import Toggle from '@ui/fields/Toggle';
import ConfirmDialog from '@ui/feedback/ConfirmDialog';
import './resources.css';
import PageBreadcrumb from '@ui/layout/PageBreadcrumb';

const toast = (msg: string, type: 'info' | 'success' | 'error') =>
  useToastStore.getState().addToast(msg, type);

/** Preset skill marketplaces (repository URLs of common skill libraries containing SKILL.md) */
const MARKETPLACES: { name: string; repo: string }[] = [
  { name: 'anthropics/skills', repo: 'https://github.com/anthropics/skills' },
  { name: 'magnus919/agent-skills', repo: 'https://github.com/magnus919/agent-skills' },
];


// ── Styles ──

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
        <button type="button" data-subtle
          aria-expanded={n.isDir ? open.has(n.path) : undefined}
          onClick={() => void pick(n)}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: `2px 8px 2px ${8 + depth * 14}px`, fontSize: 'calc(12px * var(--ui-font-scale))',
            cursor: 'pointer', color: n.isDir ? 'var(--text-primary)' : 'var(--text-secondary)', border: 0, width: '100%', textAlign: 'left',
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
        </button>
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

// ── Detail panel ──

function SkillDetailPanel({ skill, onClose, onChanged }: {
  skill: SkillDetail;
  onClose: () => void;
  onChanged: (deleted?: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await action(); } catch (failure) { setError(String(failure)); }
    finally { setBusy(false); }
  };
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
    toast(t('Deleted {{name}}.', { name: skill.name }), 'success');
    onChanged(true);
    onClose();
  };
  return (
    <div className="skill-detail" data-testid="skill-detail" aria-busy={busy}>
      <PageBreadcrumb className="resource-breadcrumb" ancestors={[{ label: t('Skills'), onClick: onClose }]} current={skill.name} />
      <div className="resource-detail-header">
        <span className="resource-mark resource-mark-large"><FileText size={28} aria-hidden="true" /></span>
        <div className="resource-identity"><h2>{skill.name}</h2><p>{skill.description || t('No description')}</p></div>
        <div className="resource-actions">
          <OutlineButton aria-expanded={showFiles} onClick={() => setShowFiles(value => !value)}>{t('View instructions')}</OutlineButton>
          <OutlineButton disabled={busy} onClick={() => setConfirmDelete(true)} style={{ color: 'var(--control-danger-color)' }}>{t('Delete')}</OutlineButton>
        </div>
      </div>
      <div className="resource-badges">
        {skill.hasScripts && <Badge text={t('Contains scripts')} tone="danger" />}
        {skill.modified && <Badge text={t('Modified')} tone="warn" />}
      </div>
      <SettingsGroup title={t('Skill settings')}>
        <div className="resource-setting-row"><div><strong>{t('Enabled')}</strong><p>{t('Make this skill available to the assistant when trusted.')}</p></div>
          <Toggle label={t('Enable {{name}}', { name: skill.name })} on={skill.enabled} disabled={busy} onChange={() => void run(toggleEnabled)} /></div>
        <div className="resource-setting-row"><div><strong>{t(skill.trusted ? 'Trusted' : 'Untrusted')}</strong><p>{t('Review the instructions and files before trusting this skill. Script execution still requires tool permissions.')}</p></div>
          <OutlineButton disabled={busy} onClick={() => void run(toggleTrust)}>{t(skill.trusted ? 'Untrust' : 'Trust')}</OutlineButton></div>
      </SettingsGroup>
      <SettingsGroup title={t('About')}>
        <dl className="resource-metadata">
          <div><dt>{t('Source')}</dt><dd>{skill.source || t('Local')}</dd></div>
          <div><dt>{t('Additional files')}</dt><dd>{t('{{count}} files', { count: skill.files.length })}</dd></div>
          {skill.allowedTools && <div><dt>{t('Allowed tools:')}</dt><dd>{skill.allowedTools}</dd></div>}
          <div><dt>{t('Folder')}</dt><dd className="skill-location"><span>{skill.dir}</span><OutlineButton disabled={busy} onClick={() => void run(() => fileOpenWith(skill.dir))}>{t('Open folder')}</OutlineButton></dd></div>
        </dl>
      </SettingsGroup>
      {showFiles && <><div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 'calc(12px * var(--ui-font-scale))', fontWeight: 'var(--fw-semibold)', marginBottom: 6 }}>{t('Files')}</div>
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
          {skill.prompt || t('Empty prompt')}
        </pre>
      </div></>}
      {error && <ErrorBox title={t('Could not update skill')} details={error} onDismiss={() => setError(null)} />}
      <ConfirmDialog open={confirmDelete} title={t('Delete skill')} message={t('Delete {{name}} and its local files?', { name: skill.name })} danger
        onCancel={() => setConfirmDelete(false)} onConfirm={() => { setConfirmDelete(false); void run(del); }} />
    </div>
  );
}

// ── Skill marketplace (overlay page) ──

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
      display: 'flex', flexDirection: 'column', minHeight: 'min(600px, 70vh)',
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

// ── Main page ──

export default function SkillsSettings() {
  const {
    metas,
    loading, error, setError, changing,
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
    toggleEnabled,
  } = useSkillsSettings();
  const [query, setQuery] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const visible = metas.filter(skill => `${skill.name} ${skill.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  const importFromUrl = async () => { await doImportUrl(); setImportOpen(false); };
  const importFromPath = async (directory: boolean) => { await doImportPath(directory); setImportOpen(false); };

  if (detail) return <SkillDetailPanel key={detail.name} skill={detail} onClose={() => setDetail(null)} onChanged={deleted => { refresh(); if (!deleted) void openDetail(detail.name); }} />;
  if (market) return <SkillMarketplacePanel metas={metas} onClose={() => setMarket(false)} onInstalled={refresh} />;

  return (
    <div style={{ position: 'relative' }}>
      <header className="resource-page-header">
        <div><h1>{t('Skills')}</h1><p>{t('Manage the skills available to your assistant.')}</p></div>
      </header>
      <SettingsDialog open={importOpen} title={t('Import skills')} icon={<Download size={16} />} width={520} testId="skills-import-dialog"
        initialFocus='[data-testid="skill-import-url"]' onClose={() => setImportOpen(false)}>
        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!warnDismissed && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 10px', borderRadius: 'var(--radius-inner)',
              background: 'var(--accent-warm-dim)', fontSize: 'calc(11px * var(--ui-font-scale))', lineHeight: 1.5, color: 'var(--accent-warm)',
            }}>
              <ShieldAlert size={14} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{t('Skills may contain scripts. Imported skills remain untrusted until you review and trust them. Script execution still follows tool permissions.')}</span>
              <IconButton compact onClick={() => setWarnDismissed(true)} data-tip={t('Close')} aria-label={t('Close')}><X size={16} /></IconButton>
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <TextInput
              data-testid="skill-import-url"
              aria-label={t('Import a skill manifest from a URL')}
              value={importUrl}
              placeholder={t('Import a skill manifest from a URL')}
              onChange={(e) => setImportUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void importFromUrl(); }}
              style={{ ...inputStyle, flex: 1, width: 'auto' }}
            />
            <OutlineButton onClick={() => void importFromUrl()} disabled={importing} style={{ ...btn, flexShrink: 0 }}>
              {importing ? t('Importing…') : t('Import')}
            </OutlineButton>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <OutlineButton onClick={() => void importFromPath(true)} disabled={importing} style={{ ...btn, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Download size={13} /> {t('Import folder')}
            </OutlineButton>
            <OutlineButton onClick={() => void importFromPath(false)} disabled={importing} style={{ ...btn, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Download size={13} /> {t('Import archive')}
            </OutlineButton>
          </div>
        </section>
      </SettingsDialog>

      <div className="resource-library-toolbar">
        <div className="resource-actions">
          <OutlineButton onClick={() => setMarket(true)}><Store size={16} />{t('Skill marketplace')}</OutlineButton>
          <OutlineButton aria-expanded={importOpen} onClick={() => setImportOpen(true)}><Plus size={16} />{t('Import skills')}</OutlineButton>
        </div>
        <div className="resource-search"><Search size={16} aria-hidden="true" /><TextInput variant="field" aria-label={t('Search skills…')} placeholder={t('Search skills…')} value={query} onChange={event => setQuery(event.target.value)} /></div>
      </div>
      <div className="skill-list">
      {loading && metas.length === 0 && <p role="status" className="resource-caption">{t('Loading…')}</p>}
      {!loading && !error && metas.length === 0 && (
        <div style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-muted)', padding: '6px 0' }}>
          {t('No skills yet. Import from a URL, folder or archive.')}
        </div>
      )}

      {metas.length > 0 && visible.length === 0 && <p className="resource-caption">{t('No matching skills.')}</p>}
      {visible.map(skill => <div className="skill-list-row" key={skill.name}>
        <button type="button" data-subtle className="skill-open" aria-label={t('Open {{name}}', { name: skill.name })} onClick={() => void openDetail(skill.name)}>
          <span className="resource-mark"><FileText size={20} aria-hidden="true" /></span>
          <span className="resource-identity"><strong>{skill.name}</strong><span>{skill.description || t('No description')}</span>
            {!skill.trusted && <span className="resource-trust">{t('Untrusted')}</span>}</span>
        </button>
        <Toggle label={t('Enable {{name}}', { name: skill.name })} disabled={changing.includes(skill.name)} on={skill.enabled} onChange={() => void toggleEnabled(skill)} />
        <IconButton aria-label={t('Open {{name}}', { name: skill.name })} onClick={() => void openDetail(skill.name)}><ChevronRight size={16} /></IconButton>
      </div>)}

      </div>
      {error && <ErrorBox title={t('Could not load skills')} details={error} onDismiss={() => setError(null)} actions={<OutlineButton onClick={refresh}>{t('Retry')}</OutlineButton>} />}
    </div>
  );
}
