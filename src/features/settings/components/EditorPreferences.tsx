import { useEditorPreferences } from '@config/editor';
import { t } from '@i18n';
import { Field, SettingsGroup, Toggle } from './ui';
import { useSettingsSave } from './SettingsSaveProvider';

export default function EditorPreferences() {
  const preferences = useEditorPreferences();
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
  </>;
}
