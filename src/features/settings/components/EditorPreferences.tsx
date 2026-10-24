import { TERMINAL_FONT_PRESETS, useTypographyStore } from '@config/typography';
import { useEditorPreferences } from '@config/editor';
import { t } from '@i18n';
import Select from '@ui/fields/Select';
import { OutlineButton } from '@ui/actions/OutlineButton';
import { Field, SettingsGroup, Toggle } from './ui';
import { useSettingsSave } from './SettingsSaveProvider';

const sizes = Array.from({ length: 15 }, (_, index) => ({ value: index + 10, label: `${index + 10}px` }));
const weights = Array.from({ length: 17 }, (_, index) => ({ value: 100 + index * 50, label: String(100 + index * 50) }));
const lineHeights = Array.from({ length: 11 }, (_, index) => ({ value: Number((1 + index / 10).toFixed(1)), label: `${(1 + index / 10).toFixed(1)}×` }));

export default function EditorPreferences() {
  const preferences = useEditorPreferences();
  const { editorFontSize, editorFontPreset, editorFontWeight, editorLineHeight, update } = useTypographyStore();
  const { save } = useSettingsSave();
  return <>
    <SettingsGroup title={t('Editor preferences')}>
      <Field title={t('Vim mode')} description={t('Use modal keybindings in the built-in editor. This applies to local and remote files.')}>
        <Toggle label={t('Vim mode')} on={preferences.vimMode} onChange={vimMode => { void save(() => preferences.update({ vimMode })); }} />
      </Field>
      <Field title={t('Show line numbers')} description={t('Show line numbers in the built-in editor.')}>
        <Toggle label={t('Show line numbers')} on={preferences.lineNumbers} onChange={lineNumbers => { void save(() => preferences.update({ lineNumbers })); }} />
      </Field>
      <Field title={t('Word wrap')}>
        <Toggle label={t('Word wrap')} on={preferences.wordWrap} onChange={wordWrap => { void save(() => preferences.update({ wordWrap })); }} />
      </Field>
    </SettingsGroup>
    <SettingsGroup title={t('Editor typography')}>
      <Field title={t('Editor font family')} description={t('Use a font installed on your system; unavailable families use the fallback fonts.')}>
        <Select aria-label={t('Editor font family')} value={editorFontPreset} options={TERMINAL_FONT_PRESETS.map(value => ({ value, label: value === 'system' ? t('System monospace') : value }))}
          onChange={editorFontPreset => { void save(() => update({ editorFontPreset })); }} style={{ width: 220 }} />
      </Field>
      <Field title={t('Editor font size')}>
        <Select aria-label={t('Editor font size')} value={editorFontSize} options={sizes} onChange={editorFontSize => { void save(() => update({ editorFontSize })); }} style={{ width: 110 }} />
      </Field>
      <Field title={t('Editor font weight')}>
        <Select aria-label={t('Editor font weight')} value={editorFontWeight} options={weights} onChange={editorFontWeight => { void save(() => update({ editorFontWeight })); }} style={{ width: 110 }} />
      </Field>
      <Field title={t('Editor line spacing')} description={t('Adjust the editor independently of terminal and chat typography.')}>
        <Select aria-label={t('Editor line spacing')} value={editorLineHeight} options={lineHeights} onChange={editorLineHeight => { void save(() => update({ editorLineHeight })); }} style={{ width: 110 }} />
      </Field>
      <div className="settings-record">
        <div data-selectable aria-label={t('Editor font preview')} style={{ fontFamily: 'var(--editor-font-family)', fontSize: 'var(--editor-font-size)', fontWeight: 'var(--editor-font-weight)', lineHeight: 'var(--editor-line-height)', whiteSpace: 'pre-wrap' }}>{'1  const value = 42;\n2  AaBb 0123'}</div>
        <OutlineButton style={{ marginTop: 12 }} onClick={() => { void save(() => update({ editorFontSize: 13, editorFontPreset: 'system', editorFontWeight: 400, editorLineHeight: 1.5 })); }}>{t('Restore default typography')}</OutlineButton>
      </div>
    </SettingsGroup>
  </>;
}
