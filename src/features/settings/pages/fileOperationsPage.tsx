import { t } from '@i18n';
import { useFileUndoSettings } from '@config/fileUndo';
import { Field, SettingsGroup, Toggle } from '../components/ui';

export function FileOperationsPage() {
  const { local, remote, update } = useFileUndoSettings();
  return <SettingsGroup title={t('File operations')}>
    <Field title={t('Local file undo')} description={t('Keep local file undo history and stage deleted files. When disabled, deletion uses the system trash without an application staging folder.')}>
      <Toggle label={t('Local file undo')} on={local} onChange={value => update({ local: value })} />
    </Field>
    <Field title={t('Remote file undo')} description={t('Keep remote file undo history and stage deleted files on the server. When disabled, remote deletion is permanent and no undo folder is created.')}>
      <Toggle label={t('Remote file undo')} on={remote} onChange={value => update({ remote: value })} />
    </Field>
    <Field title={t('Existing staged files')} layout="stacked"><span className="settings-description">{t('Disabling undo clears the current undo history. Existing staged files are kept; changing this option never permanently deletes them.')}</span></Field>
  </SettingsGroup>;
}
