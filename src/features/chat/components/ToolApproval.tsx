import { useState } from 'react';
import { t } from '@i18n';
import { ChevronDown, Pencil, Play } from '@ui/icons';
import { TextButton } from '@ui/actions/TextButton';
import { OutlineButton } from '@ui/actions/OutlineButton';
import { TextArea } from '@ui/fields/TextInput';
import { IconButton } from '@ui/actions/IconButton';
import ContextMenu from '@ui/menus/ContextMenu';
import { resolveApproval } from '@features/agent';
import { DEFAULT_TOOL_COMMAND_TIMEOUT_MS, type ToolRun } from '@features/agent/model/messageParts';
import { useComposerDrafts } from '../stores/composerDrafts';
import { useChatStore } from '../stores/chat';

/** Review and edit a pending command without changing its captured execution target. */
export default function ToolApproval({ run, conversationId, onAskAboutTool }: {
  run: ToolRun; conversationId?: string; onAskAboutTool?: (question: string) => void;
}) {
  const isCommand = run.toolName === 'run_command';
  const original = typeof run.input.command === 'string' ? run.input.command : '';
  const [command, setCommand] = useState(original);
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // The danger reason comes from Rust's authorization of the call; an edited command is checked
  // again on Run, where a dangerous edit still gets the native confirmation.
  const warning = run.danger;
  const approve = (session = false) => resolveApproval(run.toolCallId, session ? 'session' : 'once', isCommand && command !== original ? command : undefined);
  const ask = () => {
    const question = t('Explain this action before running it: {{action}}', { action: isCommand ? command : JSON.stringify(run.input) });
    if (onAskAboutTool) { onAskAboutTool(question); resolveApproval(run.toolCallId, 'deny'); return; }
    const owner = conversationId ?? Object.entries(useChatStore.getState().byTab)
      .find(([, messages]) => messages.some(message => message.parts?.some(part => part.kind === 'tool' && part.tool.toolCallId === run.toolCallId)))?.[0];
    if (!owner) return;
    const drafts = useComposerDrafts.getState();
    const previous = drafts.byTab[owner]?.text;
    drafts.setText(owner, previous ? `${previous}\n${question}` : question);
    resolveApproval(run.toolCallId, 'deny');
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-chat-composer]')?.focus());
  };
  return <div className="ai-tool-approval">
    {editing ? <TextArea autoFocus autoSizeMaxHeight={200} className="ai-tool-command-editor" aria-label={t('Command to run')} value={command}
      onChange={event => setCommand(event.target.value)} onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') { event.stopPropagation(); setCommand(original); setEditing(false); }
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && command.trim()) { event.preventDefault(); approve(); }
      }} /> : <pre className="ai-tool-approval-command" data-selectable>{isCommand ? command : JSON.stringify(run.input, null, 2)}</pre>}
    {isCommand && <div className="ai-tool-timeout">{t('Timeout {{seconds}} seconds', { seconds: DEFAULT_TOOL_COMMAND_TIMEOUT_MS / 1000 })}</div>}
    {warning && <div className="ai-tool-approval-warning">{warning}</div>}
    <div className="ai-tool-approval-actions">
      <OutlineButton onClick={() => resolveApproval(run.toolCallId, 'deny')}>{t('Reject')}</OutlineButton>
      <span className="ai-tool-approval-spacer" />
      {isCommand && <OutlineButton onClick={() => setEditing(!editing)}><Pencil size={14} />{t(editing ? 'Done editing' : 'Edit')}</OutlineButton>}
      <div className="ai-tool-run-actions">
        <TextButton className="ai-tool-run" disabled={isCommand && !command.trim()} onClick={() => approve()}><Play size={14} />{t(isCommand ? 'Run now' : 'Allow once')}</TextButton>
        <IconButton className="ai-tool-run-menu" aria-label={t('Approval options')} aria-haspopup="menu" aria-expanded={menu !== null}
          onClick={event => { const box = event.currentTarget.getBoundingClientRect(); setMenu({ x: box.right, y: box.bottom }); }}><ChevronDown size={12} /></IconButton>
      </div>
    </div>
    {menu && <ContextMenu anchor={menu} itemRole="menuitem" onClose={() => setMenu(null)} items={[
      // The narrowest grant Rust derived for this exact command wins; with an edited command (or
      // without a shape) the whole-tool session approval is the only wider choice.
      run.shape && command === original
        ? {
            label: t('Allow {{shape}} this conversation', { shape: run.shape }),
            onClick: () => { setMenu(null); resolveApproval(run.toolCallId, 'shape'); },
          }
        : { label: t('Allow for this conversation'), onClick: () => { setMenu(null); approve(true); } },
      { label: t('Ask first'), onClick: () => { setMenu(null); ask(); } },
    ]} />}
  </div>;
}
