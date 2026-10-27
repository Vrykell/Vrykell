import ErrorBox from '@ui/feedback/ErrorBox';
import { TextButton } from '@ui/actions/TextButton';
import { t } from '@i18n';
import { useWorkbenchFeedback } from '../stores/workbenchFeedback';

export default function WorkbenchFeedback() {
  const failure = useWorkbenchFeedback(state => state.failure);
  return failure && <ErrorBox title={t('Could not update workspace')} details={String(failure.error)} onDismiss={() => useWorkbenchFeedback.setState({ failure: null })}
    actions={<TextButton onClick={() => { useWorkbenchFeedback.setState({ failure: null }); failure.retry(); }}>{t('Retry')}</TextButton>} />;
}
