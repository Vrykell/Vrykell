import { useState } from 'react';
import { t } from '@i18n';
import { ArrowLeft, Bot, ChevronRight, Square } from '@ui/icons';
import { IconButton } from '@ui/actions/IconButton';
import { TextButton } from '@ui/actions/TextButton';
import ErrorBox from '@ui/feedback/ErrorBox';
import { cancelChild, openAnalysisParent, openChild } from '../services/threadOperations';
import { useAiWorkspace } from '../stores/aiWorkspace';
import { useChatStore } from '../stores/chat';
import type { ChildTask, Thread } from '../stores/childTasks';

const statuses = { running: 'Running', stopped: 'Stopped', completed: 'Completed', failed: 'Failed' } as const;

function TaskStatus({ task }: { task: ChildTask }) {
  return (
    <span className="subagent-status" data-state={task.status} role="status">
      {t(statuses[task.status])}
    </span>
  );
}

export function SubagentRow({ task, parent }: { task: ChildTask; parent: Thread }) {
  const [error, setError] = useState('');
  const title = useChatStore((state) =>
    task.thread.driver === 'builtin' ? state.conversations.find((entry) => entry.id === task.thread.id)?.title : undefined,
  );
  const side = useAiWorkspace((state) => state.sideSelected === (parent.driver === 'builtin' ? 'chat:' : 'acp:') + parent.id);
  const label = title || (task.agent.driver === 'acp' ? task.agent.name : t('Subagent'));
  return (
    <>
      <div className="subagent-row">
        <TextButton
          className="subagent-open"
          aria-label={t('Open subagent: {{title}}', { title: label })}
          onClick={() => {
            try {
              openChild(task, side);
            } catch (reason) {
              setError(String(reason));
            }
          }}>
          <Bot size={16} />
          <span className="subagent-title">{label}</span>
          <TaskStatus task={task} />
          <ChevronRight size={14} />
        </TextButton>
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
    <div className="subagent-bar" role="region" aria-label={t('Subagent')}>
      <div className="subagent-info">
        <Bot size={16} />
        <span>{t('Subagent')}</span>
        <TaskStatus task={task} />
      </div>
      {parentExists && (
        <TextButton onClick={() => openAnalysisParent(task, side)}>
          <ArrowLeft size={16} />
          {t('Open parent conversation')}
        </TextButton>
      )}
    </div>
  );
}
