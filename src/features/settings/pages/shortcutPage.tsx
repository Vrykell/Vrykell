import { Field } from '@features/settings/components/ui';
import KeyHint from '@ui/KeyHint';
import { isMacOS } from '@platform/runtime';
import { t } from '@i18n';

const SHORTCUTS: { keys: string[]; desc: string }[] = [
  { keys: ['Meta+T'], desc: 'New tab' },
  { keys: ['Meta+Shift+T'], desc: 'Reopen closed tab' },
  { keys: ['Meta+W'], desc: 'Close tab' },
  { keys: ['Meta+1–9'], desc: 'Switch to numbered tab' },
  { keys: ['Meta+D'], desc: 'Split terminal' },
  { keys: ['Meta+Shift+D'], desc: 'Split vertically' },
  { keys: ['Alt+Meta+D'], desc: 'Choose type and split' },
  { keys: ['Meta+]', 'Meta+['], desc: 'Focus another terminal' },
  { keys: ['Meta+F'], desc: 'Global search' },
  { keys: ['Meta+P'], desc: 'Command palette' },
  { keys: ['Meta+,'], desc: 'Open settings' },
  { keys: ['Escape'], desc: 'Focus command input' },
];

export function ShortcutPage() {
  return <Field title={t('Keyboard shortcuts')}>
    <div className="settings-shortcuts">
      {SHORTCUTS.map(shortcut => <div key={shortcut.desc} className="settings-shortcut-row">
        <span>{t(shortcut.desc)}</span>
        <span>{shortcut.keys.map(key => <KeyHint key={key} shortcut={isMacOS ? key : key.replace('Meta', 'Control')} />)}</span>
      </div>)}
    </div>
  </Field>;
}
