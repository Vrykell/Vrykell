import { useState, type ReactNode } from 'react';
import { t } from '@i18n';
import { OutlineButton } from '@ui/actions/OutlineButton';
import { TextInput } from '@ui/fields/TextInput';
import { ArrowRight, ChevronRight, FileCode, FolderOpen, History, Plug, Search, TerminalPrompt } from '@ui/icons';
import AppMark from '@ui/icons/AppMark';
import type { WorkspaceResource } from '../model/workspaceResources';
import LaunchStats from './LaunchStats';

export default function UnifiedStartPage({ resources, icon, onSelect, onNew, onOpen, onConnect, onHistory }: {
  resources: WorkspaceResource[]; icon: (resource: WorkspaceResource) => ReactNode; onSelect: (id: string) => void;
  onNew: (kind: 'terminal' | 'document' | 'conversation') => void; onOpen: () => void; onConnect: () => void; onHistory: () => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = resources.filter(resource => resource.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const actions = [{ label: 'New file', Icon: FileCode, action: () => onNew('document') }, { label: 'New conversation', Icon: AppMark, action: () => onNew('conversation') }, { label: 'Open file', Icon: FolderOpen, action: onOpen }, { label: 'Connect a server', Icon: Plug, action: onConnect }];
  return <div className="workspace-launch-page" data-testid="unified-start-page"><section className="ai-launchpad">
    <header className="ai-launch-header"><h2 className="ai-launch-title">{t('Unified workspace')}</h2><p className="ai-launch-description">{t('Bring terminals, files and conversations into one workspace.')}</p></header>
    <div className="ai-launch-body">
      <button type="button" className="ai-launch-option ai-launch-native" aria-label={t('New terminal')} onClick={() => onNew('terminal')}><TerminalPrompt size={32} /><span className="ai-launch-copy"><strong>{t('New terminal')}</strong><small>{t('Use the default profile')}</small></span><ArrowRight size={18} /></button>
      <LaunchStats items={[{ label: t('Open terminals'), value: resources.filter(resource => resource.kind === 'terminal').length }, { label: t('Open files and comparisons'), value: resources.filter(resource => resource.kind === 'document' || resource.kind === 'comparison').length }, { label: t('AI sessions'), value: resources.filter(resource => resource.kind === 'conversation' || resource.kind === 'agent').length }]} />
      <div className="ai-launch-grid">{actions.map(({ label, Icon, action }) => <button type="button" key={label} className="ai-launch-option" aria-label={t(label)} onClick={action}><Icon size={28} /><span className="ai-launch-copy"><strong>{t(label)}</strong></span><ChevronRight size={16} /></button>)}</div>
      <section className="ai-launch-agents" aria-label={t('Open workspace resources')}>
        <div className="ai-launch-section-heading"><h3>{t('Open workspace resources')}<span>{resources.length}</span></h3><OutlineButton onClick={onHistory}><History size={16} />{t('All history')}</OutlineButton></div>
        <div className="workspace-sidebar-search ai-launch-search"><Search size={16} /><TextInput value={query} onChange={event => setQuery(event.target.value)} aria-label={t('Search workspace resources')} placeholder={t('Search workspace resources')} /></div>
        <div className="ai-launch-grid">{filtered.map(resource => <button type="button" key={resource.id} className="ai-launch-option" aria-label={resource.title} onClick={() => onSelect(resource.id)}>{icon(resource)}<span className="ai-launch-copy"><strong>{resource.title}</strong></span><ChevronRight size={16} /></button>)}</div>
        {!filtered.length && <div className="search-empty-state">{t(resources.length ? 'No matching resources' : 'Create a tab or open a file to get started.')}</div>}
      </section>
    </div>
  </section></div>;
}
