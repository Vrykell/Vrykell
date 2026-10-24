import { IconButton } from '@ui/actions/IconButton';
import { Columns2, iconSizes } from '@ui/icons';
import { t } from '@i18n';
import { requestWorkspaceSplit } from '../services/unifiedWorkspace';

export default function WorkspaceSplitAction({ resourceId }: { resourceId: string }) {
  return <IconButton compact className="workspace-split-action" aria-label={t('Split tab')} data-tip={t('Split tab')} onClick={() => requestWorkspaceSplit(resourceId)}><Columns2 size={iconSizes.control} /></IconButton>;
}
