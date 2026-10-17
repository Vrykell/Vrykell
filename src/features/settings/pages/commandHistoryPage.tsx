import { t } from '@i18n';
import Select from '@ui/Select';
import { useCommandHistorySettings } from '@config/commandHistory';
import { Field, SettingsGroup } from '../components/ui';

export function CommandHistoryPage() {
  const { runIn, doubleClick, update } = useCommandHistorySettings();
  return <SettingsGroup title={t('Command history')}>
    <Field title={t('Command execution target')} description={t('Choose where commands run from the history panel.')}>
      <Select aria-label={t('Command execution target')} value={runIn} onChange={value => update({ runIn: value as 'new' | 'current' })}
        options={[{ value: 'new', label: t('New terminal') }, { value: 'current', label: t('Current terminal') }]} />
    </Field>
    <Field title={t('Double-click command')} description={t('Double-click inserts the command by default. Execution follows the selected target.')}>
      <Select aria-label={t('Double-click command')} value={doubleClick} onChange={value => update({ doubleClick: value as 'insert' | 'run' })}
        options={[{ value: 'insert', label: t('Insert command') }, { value: 'run', label: t('Run command') }]} />
    </Field>
  </SettingsGroup>;
}
