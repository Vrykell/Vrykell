import { useEffect, useState } from 'react';
import { t } from '@i18n';
import { OutlineButton } from '@ui/actions/OutlineButton';
import AppMark from '@ui/icons/AppMark';
import WorkspaceStartPage from '@features/workspace/components/WorkspaceStartPage';
import type { AgentInstance } from '../model/agentCatalog';
import AgentLauncher from '@features/workspace/components/AgentLauncher';

/**
 * The AI start page matches every other workspace: one action to begin and one to reach the
 * connected agents, whose searchable list stays in the existing launcher dialog.
 */
export default function AiStartPage({
  open,
  active,
  onNewConversation,
  onPick,
  suspended = false,
}: {
  open: boolean;
  active: boolean;
  onNewConversation: () => void;
  onPick: (instance: AgentInstance, cwd?: string) => void;
  suspended?: boolean;
}) {
  const [launcher, setLauncher] = useState<{ x: number; y: number } | null>(null);
  // The picker belongs to this page: leaving the workspace closes it instead of leaving it
  // floating over whatever the user opened next.
  useEffect(() => {
    if (!active) setLauncher(null);
  }, [active]);
  return (
    <div className="ai-start-page" data-testid="ai-start-page" data-active={active || undefined}>
      <WorkspaceStartPage
        icon={<AppMark size={40} />}
        title={t('Start a conversation')}
        description={t('Begin a built-in conversation or continue with a connected agent.')}
        actions={
          <>
            <OutlineButton className="primary-button" data-testid="ai-start-new-conversation" onClick={onNewConversation}>
              {t('New conversation')}
            </OutlineButton>
            <OutlineButton
              data-testid="ai-start-agents"
              aria-haspopup="dialog"
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                setLauncher({ x: box.left, y: box.bottom });
              }}>
              {t('Choose an agent…')}
            </OutlineButton>
          </>
        }
      />
      <AgentLauncher
        open={!!launcher && open && !suspended && active}
        anchor={launcher ?? undefined}
        onClose={() => setLauncher(null)}
        onPick={(name, cwd) => {
          setLauncher(null);
          onPick(name, cwd);
        }}
      />
    </div>
  );
}
