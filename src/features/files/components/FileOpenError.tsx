import { t } from '@i18n';
import { OutlineButton } from '@ui/actions/OutlineButton';
import ErrorBox from '@ui/feedback/ErrorBox';
import { useFileOpenFailure } from '../stores/fileOpenFailure';

export default function FileOpenError() {
  const failure = useFileOpenFailure(state => state.failure);
  if (!failure) return null;
  return <ErrorBox title={t('Could not open the file')} details={failure.details}
    onDismiss={() => useFileOpenFailure.setState({ failure: null })}
    actions={<OutlineButton onClick={() => { useFileOpenFailure.setState({ failure: null }); failure.retry(); }}>{t('Retry')}</OutlineButton>} />;
}
