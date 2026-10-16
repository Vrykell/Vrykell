import { useState } from 'react';
import { t, type I18nKey } from '@i18n';
import { Brain, ChevronDown, FileText, Folder, Globe, Pencil, Search, TerminalPrompt, Wrench } from '@ui/icons';
import ErrorBox from '@ui/ErrorBox';
import ToolOutput from './ToolOutput';
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

/** Quiet outcomes add no text: a finished row shows the exit code, a failure its error box,
 *  so only work in progress and blocked work need a state word. */
const STATES_WITH_CHIP: ToolRunState[] = ['running', 'approval-pending', 'denied'];

function str(value: unknown): string { return typeof value === 'string' ? value : ''; }

function summarize(run: ToolRun): { icon: React.ReactNode; text: string } {
  const input = run.input;
  const size = { size: 15 };
  // A tool we do not know (an external harness reports one) still carries a human-readable title.
  if (typeof input.title === 'string' && input.title) {
    return { icon: <Wrench {...size} />, text: input.title };
  }
  switch (run.toolName) {
    case 'run_command': return { icon: <TerminalPrompt {...size} />, text: str(input.command) };
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

/** Output body shown when a row is expanded; a structured command result carries its own field. */
function expandBody(run: ToolRun): string {
  if (run.toolName === 'run_command' && run.output && !run.error) {
    try {
      const value: unknown = JSON.parse(run.output);
      if (typeof value === 'object' && value !== null) {
        return str((value as Record<string, unknown>).output);
      }
    } catch { /* Unstructured output is displayed verbatim. */ }
  }
  return run.error ?? run.output ?? '';
}

function CommandOutputBlock({ run, paneId, framed }: { run: ToolRun; paneId?: string; framed: boolean }) {
  const block = useBlockStore(state => {
    const id = agentControl.blockForToolCall(run.toolCallId);
    return id && paneId ? state.byTab[paneId]?.find(item => item.id === id) : undefined;
  });
  const body = expandBody(run);
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
  // A failure starts expanded so a broken call is readable at a glance; an explicit toggle
  // wins from then on, which also lets the row be collapsed again. The toggle is recorded with
  // the state it was made in, so a run that fails after being collapsed reopens its error.
  const [toggled, setToggled] = useState<{ state: ToolRunState; open: boolean } | null>(null);
  const sessions = useTerminalStore(state => state.sessions);
  const { icon, text } = summarize(run);
  const chip = STATE_CHIP[run.state];
  const body = expandBody(run);
  const isCommand = run.toolName === 'run_command';
  const failed = run.state === 'error';
  const open = toggled?.state === run.state ? toggled.open : failed;
  const expandable = isCommand || body.length > 0 || failed;
  const truncated = body.length > 6000;
  return <div className="ai-tool-card" data-tool-state={run.state}>
    <button type="button" data-subtle className="ai-tool-summary" aria-expanded={open} disabled={!expandable}
      onClick={() => setToggled({ state: run.state, open: !open })}>
      {icon}<span className="ai-tool-description">{text}</span>
      {STATES_WITH_CHIP.includes(run.state) && <span style={{ color: chip.color }}>{t(chip.label)}</span>}
      {expandable && <ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.12s ease' }} />}
    </button>
    {run.state === 'approval-pending' && <div className="ai-tool-approval">
      {run.danger && <div>{run.danger}</div>}
      <div className="ai-tool-approval-actions">
        <button type="button" onClick={() => resolveApproval(run.toolCallId, 'once')}>{t('Allow once')}</button>
        {/* With a shape the narrowest grant is offered (this kind of command only); the whole-tool
            session approval stays a deliberate choice on the permissions page. */}
        {run.shape ? <button type="button" data-testid="tool-allow-shape"
          onClick={() => resolveApproval(run.toolCallId, 'shape')}>
          {t('Allow {{shape}} this conversation', { shape: run.shape })}
        </button> : <button type="button" onClick={() => resolveApproval(run.toolCallId, 'session')}>
          {t('Allow for this conversation')}
        </button>}
        <button type="button" onClick={() => resolveApproval(run.toolCallId, 'deny')}>{t('Deny')}</button>
      </div>
    </div>}
    {/* A refusal keeps its reason once the buttons are gone — the deadline, or what was blocked. */}
    {run.state === 'denied' && run.danger && (
      <div className="ai-tool-verdict" data-testid="tool-denied-reason">{run.danger}</div>
    )}
    {failed && open && <ErrorBox compact details={body || undefined}>{run.error || t('Tool execution failed')}</ErrorBox>}
    {open && !failed && (isCommand ? <CommandOutputBlock run={run} paneId={paneId} framed={framed} />
      : <ToolOutput framed={framed} text={body}>
        <pre className="ai-tool-output" data-selectable>{truncated ? `${t('Only the end of the output is shown')}\n` : ''}{body.slice(-6000)}</pre>
      </ToolOutput>)}
    {isCommand && paneId && sessions[paneId] && (open || run.state === 'approval-pending') && <button type="button" data-subtle
      className="ai-tool-terminal-link" onClick={() => showExecutionTerminal(paneId)}>{t('View terminal')}</button>}
  </div>;
}
