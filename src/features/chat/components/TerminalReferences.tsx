import { useState } from 'react';
import { t } from '@i18n';
import { ChevronDown, Terminal, X } from '@ui/icons';
import { IconButton } from '@ui/IconButton';
import { useTerminalStore } from '@features/terminal';
import { showExecutionTerminal } from '../services/conversationContext';
import type { TerminalReference } from '../model/conversation';

export default function TerminalReferences({ references, onRemove }: {
  references: TerminalReference[];
  onRemove?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const sessions = useTerminalStore(state => state.sessions);
  return <div className="chat-references">
    {references.map(reference => <div className="chat-reference" key={reference.id}>
      <div className="chat-reference-heading">
        <button type="button" data-subtle className="chat-reference-toggle" aria-expanded={expanded === reference.id}
          onClick={() => setExpanded(expanded === reference.id ? null : reference.id)}>
          <ChevronDown size={12} style={{ transform: expanded === reference.id ? 'rotate(180deg)' : undefined, transition: 'transform 0.12s ease' }} />
          <Terminal size={13} /><span>{reference.command || t('Terminal output')}</span>
        </button>
        {onRemove && <IconButton compact aria-label={t('Remove reference')} data-tip={t('Remove reference')}
          onClick={() => onRemove(reference.id)}><X size={12} /></IconButton>}
      </div>
      {expanded === reference.id && <div className="chat-reference-body">
        <div>{reference.label}</div><div>{reference.cwd}</div>
        {reference.exitCode != null && <div>{t('Exit code: {{code}}', { code: reference.exitCode })}</div>}
        <pre data-selectable>{reference.output || t('No output')}</pre>
        {!!sessions[reference.paneId] && <button type="button" data-subtle onClick={() => showExecutionTerminal(reference.paneId)}>{t('View terminal')}</button>}
      </div>}
    </div>)}
  </div>;
}
