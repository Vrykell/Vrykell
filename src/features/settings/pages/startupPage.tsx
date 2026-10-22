import { t } from '@i18n';
import { SettingsGroup, Field, Toggle } from '../components/ui';
import { useStartupSettings } from '../stores/startup';

export function StartupPage() {
  const { mode, setMode } = useStartupSettings();
  const restore = mode === 'restore';
  return <SettingsGroup title={t('Startup behavior')}>
    <Field title={t('Restore history at startup')} description={<>{t('Applies next launch. Restored sessions reconnect without restarting their commands.')} {t('When disabled, the workspace opens with a start page.')}</>}>
      <Toggle on={restore} label={t('Restore history at startup')} onChange={on => setMode(on ? 'restore' : 'empty')} />
    </Field>
  </SettingsGroup>;
}
