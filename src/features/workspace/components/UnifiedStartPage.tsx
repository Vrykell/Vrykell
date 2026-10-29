import { useState, type ReactNode } from 'react';
import { t } from '@i18n';
import { OutlineButton } from '@ui/actions/OutlineButton';
import { IconButton } from '@ui/actions/IconButton';
import { TextInput } from '@ui/fields/TextInput';
import { ArrowRight, Bot, ChevronRight, FileCode, FolderOpen, History, Plug, Search, TerminalPrompt, X } from '@ui/icons';
import AppMark from '@ui/icons/AppMark';
import type { WorkspaceResource } from '../model/workspaceResources';
import LaunchStats from './LaunchStats';

export default function UnifiedStartPage({ resources, icon, onSelect, onNew, onOpen, onConnect, onAgent, onHistory }: {
  resources: WorkspaceResource[]; icon: (resource: WorkspaceResource) => ReactNode; onSelect: (id: string) => void;
  onNew: (kind: 'terminal' | 'document' | 'conversation') => void; onOpen: () => void; onConnect: () => void; onAgent: () => void; onHistory: () => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = resources.filter(resource => resource.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const groups = [
    { title: 'Terminals and servers', actions: [
      { label: 'New terminal', description: 'Choose a shell profile', Icon: TerminalPrompt, action: () => onNew('terminal') },
      { label: 'Connect a server', description: 'Choose a saved SSH host', Icon: Plug, action: onConnect },
    ] },
    { title: 'Conversations', actions: [
      { label: 'New conversation', description: 'Start a built-in AI conversation', Icon: AppMark, action: () => onNew('conversation') },
      { label: 'ACP agents', description: 'Choose an external agent', Icon: Bot, action: onAgent },
    ] },
    { title: 'Files', actions: [
      { label: 'New file', description: 'Start an empty document', Icon: FileCode, action: () => onNew('document') },
      { label: 'Open file', description: 'Open an existing document', Icon: FolderOpen, action: onOpen },
    ] },
  ];
  return <div className="workspace-launch-page" data-testid="unified-start-page"><section className="ai-launchpad">
    <header className="ai-launch-header"><h2 className="ai-launch-title">{t('Unified workspace')}</h2><p className="ai-launch-description">{t('Choose what to open, then arrange it in one workspace.')}</p></header>
    <div className="ai-launch-body">
      <LaunchStats items={[{ label: t('Open terminals'), value: resources.filter(resource => resource.kind === 'terminal').length }, { label: t('Open files and comparisons'), value: resources.filter(resource => resource.kind === 'document' || resource.kind === 'comparison').length }, { label: t('AI sessions'), value: resources.filter(resource => resource.kind === 'conversation' || resource.kind === 'agent').length }]} />
      {groups.map(group => <section className="ai-launch-agents" key={group.title} aria-label={t(group.title)}>
        <div className="ai-launch-section-heading"><h3>{t(group.title)}</h3></div>
        <div className="ai-launch-grid">{group.actions.map(({ label, description, Icon, action }) => <button type="button" key={label} className="ai-launch-option" aria-label={t(label)} onClick={action}>
          <Icon size={28} /><span className="ai-launch-copy"><strong>{t(label)}</strong><small>{t(description)}</small></span><ChevronRight size={16} />
        </button>)}</div>
      </section>)}
      <section className="ai-launch-agents" aria-label={t('Open workspace resources')}>
        <div className="ai-launch-section-heading"><h3>{t('Open workspace resources')}<span>{resources.length}</span></h3><OutlineButton onClick={onHistory}><History size={16} />{t('All history')}</OutlineButton></div>
        <div className="workspace-sidebar-search ai-launch-search"><Search size={16} /><TextInput value={query} onChange={event => setQuery(event.target.value)} aria-label={t('Search workspace resources')} placeholder={t('Search workspace resources')} />{query && <IconButton compact aria-label={t('Clear search')} onClick={() => setQuery('')}><X size={14} /></IconButton>}</div>
        <div className="ai-launch-grid">{filtered.map(resource => <button type="button" key={resource.id} className="ai-launch-option ai-launch-resource" aria-label={resource.title} onClick={() => onSelect(resource.id)}>{icon(resource)}<span className="ai-launch-copy"><strong>{resource.title}</strong></span><ArrowRight size={16} /></button>)}</div>
        {!filtered.length && <div className="search-empty-state">{t(resources.length ? 'No matching resources' : 'Create a tab or open a file to get started.')}</div>}
      </section>
    </div>
  </section></div>;
}
