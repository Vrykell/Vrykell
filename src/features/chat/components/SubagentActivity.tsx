import { useState } from 'react';
import { t } from '@i18n';
import { ArrowLeft, Bot, ChevronRight, Square } from '@ui/icons';
import { IconButton } from '@ui/actions/IconButton';
import { TextButton } from '@ui/actions/TextButton';
import { PaneStatusFooter } from '@ui/layout/PaneStatusFooter';
import ErrorBox from '@ui/feedback/ErrorBox';
import { cancelChild, openAnalysisParent, openChild } from '../services/threadOperations';
import { useAiWorkspace } from '../stores/aiWorkspace';
import { useChatStore } from '../stores/chat';
import type { ChildTask, Thread } from '../stores/childTasks';
import ToolStateBadge from './ToolStateBadge';

const statuses = { running: 'Running', stopped: 'Stopped', completed: 'Completed', failed: 'Failed' } as const;
const toolStates = { running: 'running', stopped: 'cancelled', completed: 'done', failed: 'error' } as const;

export function SubagentRow({ task, parent }: { task: ChildTask; parent: Thread }) {
  const [error, setError] = useState('');
  const title = useChatStore((state) =>
    task.thread.driver === 'builtin' ? state.conversations.find((entry) => entry.id === task.thread.id)?.title : undefined,
  );
  const side = useAiWorkspace((state) => state.sideSelected === (parent.driver === 'builtin' ? 'chat:' : 'acp:') + parent.id);
  const label = title || (task.agent.driver === 'acp' ? task.agent.name : t('Subagent'));
  return (
    <>
      <div className="ai-tool-card subagent-row" data-tool-state={toolStates[task.status]}>
        <button
          type="button"
          data-subtle
          className="ai-tool-summary"
          aria-label={t('Open subagent: {{title}}', { title: label })}
          onClick={() => {
            try {
              openChild(task, side);
            } catch (reason) {
              setError(String(reason));
            }
          }}>
          <Bot size={15} />
          <span className="ai-tool-summary-text">
            <span className="ai-tool-label">{t('Subagent')}</span>
            <span className="ai-tool-description" data-tip={label}>
              {label}
            </span>
          </span>
          <ToolStateBadge state={toolStates[task.status]} label={t(statuses[task.status])} announce />
          <ChevronRight size={14} />
        </button>
        {task.status === 'running' && (
          <IconButton
            compact
            aria-label={t('Stop subagent: {{title}}', { title: label })}
            data-tip={t('Stop')}
            onClick={() => cancelChild(task)}>
            <Square size={14} />
          </IconButton>
        )}
      </div>
      {error && (
        <ErrorBox compact details={error}>
          {t('Thread action failed')}
        </ErrorBox>
      )}
    </>
  );
}

export function AnalysisChildBar({ task, side }: { task: ChildTask; side: boolean }) {
  const parentExists = useChatStore((state) => state.conversations.some((entry) => 'chat:' + entry.id === task.parent));
  return (
    <PaneStatusFooter role="region" aria-label={t('Subagent')} className="subagent-footer">
      <Bot size={16} />
      <span>{t('Subagent')}</span>
      <span role="status">{t(statuses[task.status])}</span>
      {parentExists && (
        <TextButton onClick={() => openAnalysisParent(task, side)}>
          <ArrowLeft size={16} />
          {t('Open parent conversation')}
        </TextButton>
      )}
    </PaneStatusFooter>
  );
}
