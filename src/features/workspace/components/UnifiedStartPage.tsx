import { t } from '@i18n';
import { OutlineButton } from '@ui/actions/OutlineButton';
import { Grid } from '@ui/icons';
import { dropdownAnchorBelow, type DropdownAnchor } from '@ui/menus/AnchoredDropdown';
import WorkspaceStartPage from './WorkspaceStartPage';

export default function UnifiedStartPage({
  onNew,
  onTerminal,
  onOpen,
  onConnect,
  onAgent,
}: {
  onNew: (kind: 'document' | 'conversation') => void;
  onTerminal: (anchor: DropdownAnchor) => void;
  onOpen: () => void;
  onConnect: (anchor: DropdownAnchor) => void;
  onAgent: (anchor: DropdownAnchor) => void;
}) {
  return (
    <div className="workspace-launch-page" data-testid="unified-start-page">
      <WorkspaceStartPage
        icon={<Grid size={40} />}
        title={t('Unified workspace')}
        description={t('Open terminals, files and conversations side by side in one workspace.')}
        columns={3}
        actions={
          <>
            <OutlineButton
              className="primary-button"
              aria-haspopup="dialog"
              onClick={(event) => onTerminal(dropdownAnchorBelow(event.currentTarget))}>
              {t('New terminal')}
            </OutlineButton>
            <OutlineButton onClick={() => onNew('document')}>{t('New file')}</OutlineButton>
            <OutlineButton onClick={onOpen}>{t('Open file')}</OutlineButton>
            <OutlineButton aria-label={t('New conversation')} onClick={() => onNew('conversation')}>
              {t('New chat')}
            </OutlineButton>
            <OutlineButton
              aria-label={t('Connect a server')}
              aria-haspopup="dialog"
              onClick={(event) => onConnect(dropdownAnchorBelow(event.currentTarget))}>
              {t('Connect')}
            </OutlineButton>
            <OutlineButton aria-haspopup="dialog" onClick={(event) => onAgent(dropdownAnchorBelow(event.currentTarget))}>
              {t('ACP agents')}
            </OutlineButton>
          </>
        }
      />
    </div>
  );
}
