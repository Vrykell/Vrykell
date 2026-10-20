import { useEditorPreferences } from '@config/editor';
import Select from '@ui/Select';
import { t } from '@i18n';
import { Field } from './ui';
import { useSettingsSave } from './SettingsSaveProvider';
export default function EditorOpeningPreferences({ remote }: { remote: boolean }) {
  const preferences = useEditorPreferences(); const { save } = useSettingsSave();
  return <>
    <Field title={t('Preferred file editor')} description={t('Open text files inside the app, or use the configured terminal command.')}>
      <Select aria-label={t('Preferred file editor')} value={remote ? preferences.remoteOpenMode : preferences.localOpenMode} options={[{ value: 'editor', label: t('Built-in editor') }, { value: 'terminal', label: t('Terminal editor') }]}
        onChange={next => { void save(() => preferences.update(remote ? { remoteOpenMode: next } : { localOpenMode: next })); }} />
    </Field>
    <Field title={t('Editor pages')} description={t('Keep files in one editor page with tabs, or use a separate workspace page for each file.')}>
      <Select aria-label={t('Editor pages')} value={preferences.pageMode} options={[{ value: 'single', label: t('One editor page with file tabs') }, { value: 'multiple', label: t('Separate editor pages') }]}
        onChange={next => { void save(() => preferences.update({ pageMode: next })); }} />
    </Field>
  </>;
}
