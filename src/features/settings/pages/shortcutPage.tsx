import { SettingsGroup } from '@features/settings/components/ui';
import KeyHint from '@ui/feedback/KeyHint';
import { isMacOS } from '@platform/runtime';
import { t } from '@i18n';
import { FILE_DIRECTORY_SHORTCUTS } from '@config/fileShortcuts';

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
  { keys: ['Meta+Shift+R'], desc: 'Redraw terminal' },
  { keys: ['Meta+,'], desc: 'Open settings' },
  { keys: [FILE_DIRECTORY_SHORTCUTS.terminal], desc: 'Switch terminal to this directory' },
  { keys: [FILE_DIRECTORY_SHORTCUTS.panel], desc: 'files.syncToCwd' },
  { keys: ['Escape'], desc: 'Focus command input' },
];

export function ShortcutPage() {
  return <SettingsGroup title={t('Keyboard shortcuts')}><div className="settings-record">
    <div className="settings-shortcuts">
      {SHORTCUTS.map(shortcut => <div key={shortcut.desc} className="settings-shortcut-row">
        <span>{t(shortcut.desc)}</span>
        <span>{shortcut.keys.map(key => <KeyHint key={key} shortcut={isMacOS ? key : key.replace('Meta', 'Control')} />)}</span>
      </div>)}
    </div>
  </div></SettingsGroup>;
}
