import { useEffect, useState } from 'react';
import { t } from '@i18n';
import { OutlineButton } from '@ui/actions/OutlineButton';
import AppMark from '@ui/icons/AppMark';
import { dropdownAnchorBelow, type DropdownAnchor } from '@ui/menus/AnchoredDropdown';
import WorkspaceStartPage from '@features/workspace/components/WorkspaceStartPage';
import AgentLauncher from '@features/workspace/components/AgentLauncher';
import type { AgentInstance } from '../model/agentCatalog';

export default function AiStartPage({
  active,
  onNewConversation,
  onPick,
  suspended = false,
}: {
  active: boolean;
  onNewConversation: () => void;
  onPick: (instance: AgentInstance, cwd?: string) => void;
  suspended?: boolean;
}) {
  const [launcher, setLauncher] = useState<DropdownAnchor | null>(null);
  useEffect(() => {
    if (!active || suspended) setLauncher(null);
  }, [active, suspended]);
  return (
    <div className="workspace-launch-page" data-testid="ai-start-page">
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
              onClick={(event) => setLauncher(dropdownAnchorBelow(event.currentTarget))}>
              {t('Choose an agent…')}
            </OutlineButton>
          </>
        }
      />
      <AgentLauncher
        open={!!launcher && active && !suspended}
        anchor={launcher ?? undefined}
        onClose={() => setLauncher(null)}
        onPick={onPick}
      />
    </div>
  );
}
