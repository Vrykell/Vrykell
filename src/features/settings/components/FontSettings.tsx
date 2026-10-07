import { useTypographyStore } from '@config/typography';
import Select from '@ui/Select';
import { t } from '@i18n';
import { Field, btnStyle } from './ui';
import { useSettingsSave } from './SettingsSaveProvider';

const pageSizes = Array.from({ length: 9 }, (_, index) => ({ value: index + 10, label: `${index + 10}px` }));
const terminalSizes = Array.from({ length: 15 }, (_, index) => ({ value: index + 10, label: `${index + 10}px` }));

export default function FontSettings() {
  const { uiFontSize, terminalFontSize, terminalRenderer, update, reset } = useTypographyStore();
  const { save } = useSettingsSave();
  const rendererOptions = [
    { value: 'webgl' as const, label: t('settings.font.rendererWebgl') },
    { value: 'dom' as const, label: t('settings.font.rendererDom') },
  ];
  return <div aria-label={t('settings.font.group')}>
    <Field title={t('settings.font.pageTitle')} description={t('settings.font.pageDescription')}>
      <div className="settings-font-row">
        <Select aria-label={t('settings.font.pageTitle')} value={uiFontSize} options={pageSizes} onChange={uiFontSize => { void save(() => update({ uiFontSize })); }} style={{ width: 110 }} />
      </div>
    </Field>
    <Field title={t('settings.font.terminalTitle')} description={t('settings.font.terminalDescription')}>
      <div className="settings-font-row">
        <Select aria-label={t('settings.font.terminalTitle')} value={terminalFontSize} options={terminalSizes} onChange={terminalFontSize => { void save(() => update({ terminalFontSize })); }} style={{ width: 110 }} />
      </div>
      <button type="button" onClick={reset} style={{ ...btnStyle, marginTop: 12 }}>{t('settings.font.reset')}</button>
    </Field>
    <Field title={t('settings.font.rendererTitle')} description={t('settings.font.rendererDescription')}>
      <div className="settings-font-row">
        <Select aria-label={t('settings.font.rendererTitle')} value={terminalRenderer} options={rendererOptions} onChange={terminalRenderer => { void save(() => update({ terminalRenderer })); }} style={{ width: 190 }} />
      </div>
    </Field>
  </div>;
}
