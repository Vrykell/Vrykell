import { useState } from 'react';
import { t } from '@i18n';
import { ChevronDown, TerminalPrompt, X } from '@ui/icons';
import { IconButton } from '@ui/IconButton';
import { useTerminalStore } from '@features/terminal';
import BlockOutput from '@features/terminal/components/BlockOutput';
import { showExecutionTerminal } from '../services/conversationContext';
import type { TerminalReference } from '../model/conversation';
import ToolOutput from './ToolOutput';

export default function TerminalReferences({ references, onRemove, framed = true }: {
  references: TerminalReference[];
  onRemove?: (id: string) => void;
  framed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const sessions = useTerminalStore(state => state.sessions);
  return <div className="chat-references">
    {references.map(reference => {
      const open = !collapsed.has(reference.id);
      return <div className="chat-reference ai-tool-card" key={reference.id}>
        <div className="chat-reference-heading">
          <button type="button" data-subtle className="ai-tool-summary chat-reference-toggle" aria-expanded={open}
            onClick={() => setCollapsed(previous => {
              const next = new Set(previous);
              if (open) next.add(reference.id); else next.delete(reference.id);
              return next;
            })}>
            <TerminalPrompt size={15} aria-hidden="true" />
            <span className="ai-tool-description">{reference.command || t('Terminal output')}</span>
            <ChevronDown size={14} aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.12s ease' }} />
          </button>
          {onRemove && <IconButton compact aria-label={t('Remove reference')} data-tip={t('Remove reference')}
            onClick={() => onRemove(reference.id)}><X size={12} /></IconButton>}
        </div>
        {open && <div className="chat-reference-body">
          <div className="chat-reference-meta"><span>{reference.label}</span>
            {reference.cwd && <span>{reference.cwd}</span>}
            {reference.exitCode != null && <span>{t('Exit code: {{code}}', { code: reference.exitCode })}</span>}
          </div>
          <ToolOutput framed={framed} text={reference.output} copyTestId={`reference-output-copy-${reference.id}`}>
            <div className="ai-tool-output">
              {reference.output ? <BlockOutput text={reference.output} flush={framed} /> : <span>{t('No output')}</span>}
            </div>
          </ToolOutput>
          {!!sessions[reference.paneId] && <button type="button" data-subtle className="ai-tool-terminal-link"
            onClick={() => showExecutionTerminal(reference.paneId)}>{t('View terminal')}</button>}
        </div>}
      </div>;
    })}
  </div>;
}
