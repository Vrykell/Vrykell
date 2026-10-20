import { t, useLanguagePreferences } from '@i18n';
import Select from '@ui/Select';
import { Field, SettingsGroup } from '../components/ui';
import { useSettingsSave } from '../components/SettingsSaveProvider';

export function LanguagePage() {
  const { preference, setPreference } = useLanguagePreferences();
  const { save } = useSettingsSave();
  return <SettingsGroup title={t('Language')}>
    <Field title={t('Application language')} description={t('Choose the interface language. Changes apply immediately.')}>
      <Select aria-label={t('Application language')} value={preference} onChange={next => { void save(() => setPreference(next)); }} options={[
        { value: 'zh', label: t('Simplified Chinese') }, { value: 'en', label: t('English') }, { value: 'system', label: t('Follow system') },
      ]} />
    </Field>
  </SettingsGroup>;
}
