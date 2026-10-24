import { OutlineButton } from '@ui/OutlineButton';
import { TERMINAL_FONT_PRESETS, useTypographyStore } from '@config/typography';
import Select from '@ui/Select';
import { t } from '@i18n';
import { SettingsGroup, Field, Toggle } from './ui';
import { useSettingsSave } from './SettingsSaveProvider';

const pageSizes = Array.from({ length: 9 }, (_, index) => ({ value: index + 10, label: `${index + 10}px` }));
const terminalSizes = Array.from({ length: 15 }, (_, index) => ({ value: index + 10, label: `${index + 10}px` }));
const weights = Array.from({ length: 17 }, (_, index) => ({ value: 100 + index * 50, label: String(100 + index * 50) }));
const lineHeights = Array.from({ length: 7 }, (_, index) => ({ value: Number((1 + index / 10).toFixed(1)), label: `${(1 + index / 10).toFixed(1)}×` }));

export default function FontSettings() {
  const { uiFontSize, terminalFontSize, chatFontSize, terminalRenderer, terminalFontPreset, terminalFontWeight, terminalLineHeight, commandHighlighting, terminalCursorBlink, compositionCursorBlink, update, reset } = useTypographyStore();
  const { save } = useSettingsSave();
  const rendererOptions = [
    { value: 'webgl' as const, label: t('settings.font.rendererWebgl') },
    { value: 'dom' as const, label: t('settings.font.rendererDom') },
  ];
  return <div aria-label={t('settings.font.group')}>
    <SettingsGroup title={t('Typography')}>
      <Field title={t('settings.font.pageTitle')} description={t('settings.font.pageDescription')}>
        <div className="settings-font-row">
          <Select aria-label={t('settings.font.pageTitle')} value={uiFontSize} options={pageSizes} onChange={uiFontSize => { void save(() => update({ uiFontSize })); }} style={{ width: 110 }} />
        </div>
      </Field>
      <Field title={t('settings.font.terminalTitle')} description={t('settings.font.terminalDescription')}>
        <div className="settings-font-row">
          <Select aria-label={t('settings.font.terminalTitle')} value={terminalFontSize} options={terminalSizes} onChange={terminalFontSize => { void save(() => update({ terminalFontSize })); }} style={{ width: 110 }} />
        </div>
      </Field>
      <Field title={t('Terminal font family')} description={t('Use a font installed on your system; unavailable families use the fallback fonts.')}>
        <Select aria-label={t('Terminal font family')} value={terminalFontPreset}
          options={TERMINAL_FONT_PRESETS.map(value => ({ value, label: value === 'system' ? t('System monospace') : value }))}
          onChange={terminalFontPreset => { void save(() => update({ terminalFontPreset })); }} style={{ width: 220 }} />
      </Field>
      <Field title={t('AI chat font size')} description={t('Adjust text size in the AI chat panel. Changes are saved and applied immediately.')}>
        <Select aria-label={t('AI chat font size')} value={chatFontSize} options={terminalSizes}
          onChange={chatFontSize => { void save(() => update({ chatFontSize })); }} style={{ width: 110 }} />
      </Field>
      <Field title={t('Terminal font weight')} description={t('Variable fonts support fine weight adjustments; static fonts use the nearest installed weight.')}>
        <Select aria-label={t('Terminal font weight')} value={terminalFontWeight} options={weights}
          onChange={terminalFontWeight => { void save(() => update({ terminalFontWeight })); }} style={{ width: 110 }} />
      </Field>
      <Field title={t('Terminal line spacing')} description={t('Adjust line spacing for terminal input, live output and command history.')}>
        <Select aria-label={t('Terminal line spacing')} value={terminalLineHeight} options={lineHeights}
          onChange={terminalLineHeight => { void save(() => update({ terminalLineHeight })); }} style={{ width: 110 }} />
      </Field>
      <Field title={t('settings.font.rendererTitle')} description={t('settings.font.rendererDescription')}>
        <div className="settings-font-row">
          <Select aria-label={t('settings.font.rendererTitle')} value={terminalRenderer} options={rendererOptions} onChange={terminalRenderer => { void save(() => update({ terminalRenderer })); }} style={{ width: 190 }} />
        </div>
      </Field>
      <Field title={t('Command syntax highlighting')} description={t('Color commands, arguments and shell operators.')}>
        <Toggle label={t('Command syntax highlighting')} on={commandHighlighting}
          onChange={commandHighlighting => { void save(() => update({ commandHighlighting })); }} />
      </Field>
    </SettingsGroup>
    <SettingsGroup title={t('Cursor')}>
      <Field title={t('Terminal cursor blinking')} description={t('Blink the classic terminal cursor. Turn off to keep it steady while typing.')}>
        <Toggle label={t('Terminal cursor blinking')} on={terminalCursorBlink} onChange={terminalCursorBlink => { void save(() => update({ terminalCursorBlink })); }} />
      </Field>
      <Field title={t('Composition cursor blinking')} description={t('Blink the simulated cursor while composing text with an input method.')}>
        <Toggle label={t('Composition cursor blinking')} on={compositionCursorBlink} onChange={compositionCursorBlink => { void save(() => update({ compositionCursorBlink })); }} />
      </Field>
    </SettingsGroup>
    <SettingsGroup title={t('Preview')}>
      <div className="settings-record">
        <div className="settings-terminal-preview" data-selectable aria-label={t('Terminal font preview')}>
          <div>~/project $ ls</div>
          <div>{t('Directories')}  AaBb 0123  ─│┌┐   </div>
        </div>
        <div className="settings-chat-preview" data-selectable aria-label={t('AI chat font preview')}>
          {t('AI chat font preview')} — AaBb 0123
        </div>
        <OutlineButton type="button" onClick={() => { void save(reset); }} style={{ marginTop: 12 }}>{t('Restore default typography')}</OutlineButton>
      </div>
    </SettingsGroup>
  </div>;
}
