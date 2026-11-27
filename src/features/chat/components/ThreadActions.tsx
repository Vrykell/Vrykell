import { useEffect, useRef, useState } from 'react';
import { t } from '@i18n';
import { Ellipsis, iconSizes } from '@ui/icons';
import { IconButton } from '@ui/actions/IconButton';
import { OutlineButton } from '@ui/actions/OutlineButton';
import { TextArea } from '@ui/fields/TextInput';
import Select from '@ui/fields/Select';
import ErrorBox from '@ui/feedback/ErrorBox';
import ToolDialog from '@ui/feedback/ToolDialog';
import ContextMenu, { type MenuAnchor } from '@ui/menus/ContextMenu';
import { acpHarnesses } from '@platform/api/acp';
import { agentCatalog } from '../model/agentCatalog';
import { useHarnessStore } from '../stores/harness';
import { useChatStore } from '../stores/chat';
import { useAiWorkspace } from '../stores/aiWorkspace';
import { useTurnCheckpoints, restoreTurn } from '../services/turnCheckpoints';
import {
  cancelChild,
  delegateTask,
  forkThread,
  insertChildResult,
  openChild,
  supportsHeadFork,
  threadKey,
  useChildTasks,
  type ChildTask,
  type Thread,
} from '../services/threadOperations';

const statuses = { running: 'Running', completed: 'Completed', failed: 'Failed', stopped: 'Stopped' } as const;

function ChildTaskTitle({ task }: { task: ChildTask }) {
  const local = useChatStore((state) =>
    task.agent.driver === 'builtin' ? state.conversations.find((c) => c.id === task.thread.id)?.title : undefined,
  );
  const external = useHarnessStore((state) =>
    task.agent.driver === 'acp' ? state.byTab[task.thread.id]?.messages.find((m) => m.role === 'user')?.content : undefined,
  );
  const agent = task.agent.driver === 'builtin' ? t('Built-in agent') : task.agent.name;
  return (
    <div className="thread-child-title">
      <strong>{local || external || agent}</strong>
      {(local || external) && <small>{agent}</small>}
    </div>
  );
}

export default function ThreadActions({
  thread,
  question,
  answer,
  pending,
}: {
  thread: Thread;
  question: string;
  answer?: string;
  pending?: boolean;
}) {
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const [dialog, setDialog] = useState<'tasks' | 'restore' | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const session = useHarnessStore((state) => (thread.driver === 'acp' ? state.byTab[thread.id] : undefined));
  const nativeBusy = useChatStore((state) => thread.driver === 'builtin' && state.sendingTabs.includes(thread.id));
  const checkpoint = useTurnCheckpoints((state) => state.byQuestion[question]);
  const allTasks = useChildTasks((state) => state.tasks);
  const tasks = allTasks.filter((task) => task.parent === threadKey(thread, session) && task.question === question);
  const [agents, setAgents] = useState(() => agentCatalog([]));
  const [agentId, setAgentId] = useState('builtin');
  const [instruction, setInstruction] = useState('');
  const side = useAiWorkspace((state) => state.sideSelected === (thread.driver === 'builtin' ? 'chat:' : 'acp:') + thread.id);
  const active = nativeBusy || session?.pending || session?.stopping;
  const forkable =
    answer &&
    !active &&
    (thread.driver === 'builtin' ||
      (supportsHeadFork(session) &&
        session?.messages
          .slice()
          .reverse()
          .find((msg) => msg.role === 'user')?.id === question));
  useEffect(() => {
    if (dialog !== 'tasks') return;
    let mounted = true;
    void acpHarnesses()
      .then((configs) => {
        if (mounted) setAgents(agentCatalog(configs ?? []).filter((agent) => agent.enabled));
      })
      .catch((reason) => {
        if (mounted) setError(String(reason));
      });
    return () => {
      mounted = false;
    };
  }, [dialog]);
  const close = () => {
    setDialog(null);
    trigger.current?.focus();
  };
  const run = async (operation: () => Promise<void> | void) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const openTasks = () => {
    setAgentId(session ? `acp:${session.harness}` : 'builtin');
    setDialog('tasks');
  };
  const launch = () => {
    const agent = agents.find((entry) => entry.id === agentId);
    if (!agent || !instruction.trim()) return;
    delegateTask(thread, question, agent.instance, instruction.trim());
    setInstruction('');
  };
  const canAssign = !!instruction.trim() && agents.some((entry) => entry.id === agentId);
  const assign = () => {
    void run(launch);
  };
  const failure = error && (
    <ErrorBox compact details={error}>
      {t('Thread action failed')}
    </ErrorBox>
  );
  if (pending && !tasks.length && !checkpoint) return null;
  return (
    <>
      <IconButton
        ref={trigger}
        compact
        aria-label={t('Thread actions')}
        data-tip={t('Thread actions')}
        aria-haspopup="menu"
        aria-expanded={!!menu}
        disabled={busy}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setMenu({ x: rect.left, y: rect.bottom + 4 });
        }}>
        <Ellipsis size={iconSizes.compact} />
      </IconButton>
      {!!tasks.length && <OutlineButton onClick={openTasks}>{t('Subagents ({{count}})', { count: tasks.length })}</OutlineButton>}
      {menu && (
        <ContextMenu
          anchor={menu}
          itemRole="menuitem"
          onClose={() => setMenu(null)}
          items={[
            ...(forkable
              ? [
                  {
                    label: t('Fork from this reply'),
                    onClick: () => {
                      void run(() => forkThread(thread, answer, question));
                    },
                  },
                ]
              : []),
            { label: t('Subagents'), onClick: openTasks },
            ...(checkpoint && !active ? [{ label: t('Restore files from this turn'), onClick: () => setDialog('restore') }] : []),
          ]}
        />
      )}
      {!dialog && failure}
      {dialog === 'restore' && checkpoint && (
        <ToolDialog label={t('Restore files from this turn')} onClose={close} busy={busy}>
          <p>{t('Restore these files to their state before this turn?')}</p>
          <ul>
            {checkpoint.files.map((file) => (
              <li key={file}>
                <code>{file}</code>
              </li>
            ))}
          </ul>
          {failure}
          <footer className="tool-dialog-footer">
            <OutlineButton disabled={busy} onClick={close}>
              {t('Cancel')}
            </OutlineButton>
            <OutlineButton
              disabled={busy}
              onClick={() => {
                void run(async () => {
                  await restoreTurn(question);
                  close();
                });
              }}>
              {t('Restore files')}
            </OutlineButton>
          </footer>
        </ToolDialog>
      )}
      {dialog === 'tasks' && (
        <ToolDialog
          label={t('Subagents')}
          onClose={close}
          initialFocus="textarea"
          busy={busy}
          onSubmit={canAssign ? assign : undefined}
          actions={
            <OutlineButton className="primary-button" disabled={busy || !canAssign} onClick={assign}>
              {t('Assign task')}
            </OutlineButton>
          }>
          {tasks.map((task) => (
            <div key={task.id} className="thread-child-row">
              <ChildTaskTitle task={task} />
              <span role="status">{t(statuses[task.status])}</span>
              <OutlineButton
                onClick={() => {
                  void run(() => {
                    openChild(task, side);
                    close();
                  });
                }}>
                {t('Open conversation')}
              </OutlineButton>
              {task.status === 'running' && <OutlineButton onClick={() => cancelChild(task)}>{t('Stop')}</OutlineButton>}
              {task.status === 'completed' && (
                <OutlineButton
                  onClick={() => {
                    void run(async () => {
                      await insertChildResult(thread, task);
                      close();
                    });
                  }}>
                  {t('Insert result into draft')}
                </OutlineButton>
              )}
            </div>
          ))}
          <div className="thread-task-form">
            <Select
              aria-label={t('Choose agent')}
              value={agentId}
              options={agents.map((entry) => ({ value: entry.id, label: entry.label }))}
              onChange={setAgentId}
            />
            <TextArea
              variant="field"
              aria-label={t('Task instructions')}
              placeholder={t('Task instructions')}
              rows={3}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
            />
          </div>
          {failure}
        </ToolDialog>
      )}
    </>
  );
}
