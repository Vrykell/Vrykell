import Select from '@ui/Select';
import { t } from '@i18n';
import { SettingsGroup, Field } from '../components/ui';
import { useSettingsSave } from '../components/SettingsSaveProvider';
import { useStartupSettings } from '../stores/startup';

export function StartupPage() {
  const { mode, setMode } = useStartupSettings();
  const { save } = useSettingsSave();
  return <SettingsGroup title={t('Startup behavior')}><Field title="启动时打开" description={<>{t('Applies next launch. Restored sessions reconnect without restarting their commands.')} {t('Previous sessions remain available in history. When none can be restored, a default terminal opens.')}</>}>
    <Select aria-label="启动时打开" value={mode} onChange={next => { void save(() => setMode(next)); }} options={[
      { value: 'restore', label: '恢复上次会话' },
      { value: 'default', label: '新建默认终端' },
      { value: 'empty', label: '显示会话记录' },
    ]} />
  </Field></SettingsGroup>;
}
