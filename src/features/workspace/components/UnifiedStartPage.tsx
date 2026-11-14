import { t } from '@i18n';
import { OutlineButton } from '@ui/actions/OutlineButton';
import { Grid } from '@ui/icons';
import WorkspaceStartPage from './WorkspaceStartPage';

/**
 * The unified workspace starts from the same simple page as every other workspace: the
 * actions place a first resource, and the strip above already lists what is open.
 */
export default function UnifiedStartPage({ onNew, onOpen, onConnect, onAgent }: {
  onNew: (kind: 'terminal' | 'document' | 'conversation') => void; onOpen: () => void; onConnect: () => void; onAgent: () => void;
}) {
  return <div className="workspace-launch-page" data-testid="unified-start-page">
    <WorkspaceStartPage icon={<Grid size={40} />} title={t('Unified workspace')}
      description={t('Open terminals, files and conversations side by side in one workspace.')}
      columns={3}
      actions={<>
        <OutlineButton className="primary-button" onClick={() => onNew('terminal')}>{t('New terminal')}</OutlineButton>
        <OutlineButton onClick={() => onNew('document')}>{t('New file')}</OutlineButton>
        <OutlineButton onClick={onOpen}>{t('Open file')}</OutlineButton>
        <OutlineButton onClick={() => onNew('conversation')}>{t('New conversation')}</OutlineButton>
        <OutlineButton onClick={onConnect}>{t('Connect a server')}</OutlineButton>
        <OutlineButton onClick={onAgent}>{t('ACP agents')}</OutlineButton>
      </>} />
  </div>;
}
