import { useState, type ReactNode } from 'react';
import { t, type I18nKey } from '@i18n';
import { Brain, Check, ChevronRight, FileText, Folder, Globe, Pencil, Search, Terminal, Wrench } from '@ui/icons';
import ErrorBox from '@ui/ErrorBox';
import CopyButton from '@ui/CopyButton';
import BlockOutput from '@features/terminal/components/BlockOutput';
import { useBlockStore, useTerminalStore } from '@features/terminal';
import { agentControl } from '@features/agent/services/agentControl';
import { resolveApproval } from '@features/agent';
import { showExecutionTerminal } from '../services/conversationContext';
import type { ToolRun, ToolRunState } from '@features/agent/model/messageParts';

const STATE_CHIP: Record<ToolRunState, { label: I18nKey; color: string }> = {
  running: { label: 'Running', color: 'var(--accent-warm)' },
  'approval-pending': { label: 'Awaiting approval', color: 'var(--accent-warm)' },
  done: { label: 'Succeeded', color: 'var(--success)' },
  error: { label: 'Failed', color: 'var(--error)' },
  denied: { label: 'Denied', color: 'var(--text-muted)' },
};

function str(value: unknown): string { return typeof value === 'string' ? value : ''; }

function summarize(run: ToolRun): { icon: React.ReactNode; text: string } {
  const input = run.input;
  const size = { size: 13 };
  switch (run.toolName) {
    case 'run_command': return { icon: <Terminal {...size} />, text: str(input.command) };
    case 'read_file': return { icon: <FileText {...size} />, text: t('Read {{path}}', { path: str(input.path) }) };
    case 'edit_file': return { icon: <Pencil {...size} />, text: t('Edit {{path}}', { path: str(input.path) }) };
    case 'write_file': return { icon: <Pencil {...size} />, text: t('Write {{path}}', { path: str(input.path) }) };
    case 'search_files': return { icon: <Search {...size} />, text: t('Search {{query}}', { query: str(input.query) }) };
    case 'list_dir': return { icon: <Folder {...size} />, text: t('List {{path}}', { path: str(input.path) }) };
    case 'web_search':
    case 'google_search': return { icon: <Globe {...size} />, text: t('Web search {{query}}', { query: str(input.query) }).trim() };
    case 'web_fetch': return { icon: <Globe {...size} />, text: t('Fetch {{url}}', { url: str(input.url) }) };
    case 'think': return { icon: <Brain {...size} />, text: t('Thinking process') };
    default: return { icon: <Wrench {...size} />, text: run.toolName };
  }
}

function expandBody(run: ToolRun): { exitCode?: number; body: string } {
  if (run.toolName === 'run_command' && run.output && !run.error) {
    try {
      const value: unknown = JSON.parse(run.output);
      if (typeof value === 'object' && value !== null) {
        const record = value as Record<string, unknown>;
        return { exitCode: typeof record.exitCode === 'number' ? record.exitCode : undefined, body: str(record.output) };
      }
    } catch { /* Unstructured output is displayed verbatim. */ }
  }
  return { body: run.error ?? run.output ?? '' };
}

/**
 * Expanded tool output. The terminal snapshot renders at full height: the `.ai-tool-output`
 * box is the only scroll container, so no second scrollbar appears. In the chat panel the
 * output also drops its own terminal surface and gains a copy target in the top-right corner.
 */
function ToolOutput({ framed, text, children }: { framed: boolean; text: string; children: ReactNode }) {
  return <div className="ai-tool-frame">
    {children}
    {framed && text.length > 0 && <CopyButton className="ai-tool-copy" testId="tool-output-copy"
      text={text} label={t('Copy output')} />}
  </div>;
}

function CommandOutputBlock({ run, paneId, framed }: { run: ToolRun; paneId?: string; framed: boolean }) {
  const block = useBlockStore(state => {
    const id = agentControl.blockForToolCall(run.toolCallId);
    return id && paneId ? state.byTab[paneId]?.find(item => item.id === id) : undefined;
  });
  const { body } = expandBody(run);
  const running = run.state === 'running';
  const text = block?.outputText || body;
  return <ToolOutput framed={framed} text={text}>
    <div className="ai-tool-output">
      {block?.outputHtml ? <BlockOutput text={block.outputHtml} isHtml flush={framed} />
        : text ? <BlockOutput text={text} flush={framed} />
          : <span>{t(running ? 'Command running…' : 'No output')}</span>}
    </div>
  </ToolOutput>;
}

/**
 * Tool status, approval and output share one flat row in the exchange.
 * `framed` marks the chat panel presentation, where expanded output sits inside the
 * shared code-block frame and therefore drops its own terminal surface.
 */
export default function ToolRunCard({ run, paneId, framed = false }: { run: ToolRun; paneId?: string; framed?: boolean }) {
  const [open, setOpen] = useState(false);
  const sessions = useTerminalStore(state => state.sessions);
  const { icon, text } = summarize(run);
  const chip = STATE_CHIP[run.state];
  const { exitCode, body } = expandBody(run);
  const isCommand = run.toolName === 'run_command';
  const expandable = isCommand || body.length > 0;
  const truncated = body.length > 6000;
  return <div className="ai-tool-card" data-tool-state={run.state}>
    <button type="button" data-subtle className="ai-tool-summary" aria-expanded={open} disabled={!expandable}
      onClick={() => setOpen(!open)}>
      {icon}<span className="ai-tool-description">{text}</span>
      {isCommand && exitCode != null && <span className="ai-tool-exit" style={{ color: exitCode === 0 ? 'var(--success)' : 'var(--error)' }}><Check size={11} />{exitCode}</span>}
      <span style={{ color: chip.color }}>{t(chip.label)}</span>
      {expandable && <ChevronRight size={12} style={{ transform: open ? 'rotate(90deg)' : undefined }} />}
    </button>
    {run.state === 'approval-pending' && <div className="ai-tool-approval">
      {run.danger && <div>{run.danger}</div>}
      <div className="ai-tool-approval-actions">
        <button type="button" onClick={() => resolveApproval(run.toolCallId, 'once')}>{t('Allow once')}</button>
        <button type="button" onClick={() => resolveApproval(run.toolCallId, 'session')}>{t('Allow for this conversation')}</button>
        <button type="button" onClick={() => resolveApproval(run.toolCallId, 'deny')}>{t('Deny')}</button>
      </div>
    </div>}
    {run.state === 'error' && <ErrorBox compact details={body || undefined}>{run.error || t('Tool execution failed')}</ErrorBox>}
    {open && run.state !== 'error' && (isCommand ? <CommandOutputBlock run={run} paneId={paneId} framed={framed} />
      : <ToolOutput framed={framed} text={body}>
        <pre className="ai-tool-output" data-selectable>{truncated ? `${t('Only the end of the output is shown')}\n` : ''}{body.slice(-6000)}</pre>
      </ToolOutput>)}
    {isCommand && paneId && sessions[paneId] && (open || run.state === 'approval-pending') && <button type="button" data-subtle
      className="ai-tool-terminal-link" onClick={() => showExecutionTerminal(paneId)}>{t('View terminal')}</button>}
  </div>;
}
