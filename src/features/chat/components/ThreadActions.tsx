import { useRef, useState } from 'react';
import { t } from '@i18n';
import { Ellipsis, iconSizes } from '@ui/icons';
import { IconButton } from '@ui/actions/IconButton';
import { OutlineButton } from '@ui/actions/OutlineButton';
import ErrorBox from '@ui/feedback/ErrorBox';
import ToolDialog from '@ui/feedback/ToolDialog';
import ContextMenu, { type MenuAnchor } from '@ui/menus/ContextMenu';
import { useHarnessStore } from '../stores/harness';
import { useChatStore } from '../stores/chat';
import { useTurnCheckpoints, restoreTurn } from '../services/turnCheckpoints';
import { forkThread, supportsHeadFork, type Thread } from '../services/threadOperations';

export default function ThreadActions({ thread, question, answer }: { thread: Thread; question: string; answer?: string }) {
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const [dialog, setDialog] = useState<'restore' | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const session = useHarnessStore((state) => (thread.driver === 'acp' ? state.byTab[thread.id] : undefined));
  const nativeBusy = useChatStore((state) => thread.driver === 'builtin' && state.sendingTabs.includes(thread.id));
  const checkpoint = useTurnCheckpoints((state) => state.byQuestion[question]);
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
  const failure = error && (
    <ErrorBox compact details={error}>
      {t('Thread action failed')}
    </ErrorBox>
  );
  if (!forkable && !(checkpoint && !active) && !dialog && !error) return null;
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
    </>
  );
}
