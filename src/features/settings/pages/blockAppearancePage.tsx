/**
 * Block appearance: background and rail colors for AI chat, terminal command and failed-command blocks.
 */
import { t } from '@i18n';
import { themes } from '@config/theme/tokens';
import { OutlineButton } from '@ui/OutlineButton';
import Select from '@ui/Select';
import { useTheme } from '@app/providers/ThemeProvider';
import { useTerminalThemeStore } from '@features/settings/model/terminalTheme';
import { blockBackgroundValue, blockColorOptions, type BlockColorGroup } from '../model/blockColors';
import { SettingsGroup, Field, Toggle } from '@features/settings/components/ui';
import { useSettingsSave } from '../components/SettingsSaveProvider';

export function BlockAppearancePage() {
  const { mode } = useTheme();
  const config = useTerminalThemeStore((s) => s.config);
  const themeUpdate = useTerminalThemeStore((s) => s.update);
  const { save } = useSettingsSave();
  const blockTypes: { group: BlockColorGroup; title: string; color: string; rail: string; enabled: string; defaultRail: string; defaultEnabled: boolean }[] = [
    { group: 'ai', title: t('AI chat block'), color: '--ai-block-bg', rail: '--ai-block-rail', enabled: '--ai-block-bg-enabled', defaultRail: themes[mode].textCaret, defaultEnabled: true },
    { group: 'command', title: t('Terminal command block'), color: '--command-block-bg', rail: '--command-block-rail', enabled: '--command-block-bg-enabled', defaultRail: themes[mode].borderStrong, defaultEnabled: false },
    { group: 'failed', title: t('Failed command block'), color: '--failed-block-bg', rail: '--failed-block-rail', enabled: '--failed-block-bg-enabled', defaultRail: themes[mode].errorLight, defaultEnabled: true },
  ];
  const updateBlockVar = (key: string, value: string) => themeUpdate({ vars: { ...useTerminalThemeStore.getState().config.vars, [key]: value } });
  // The rail carries the picked colour; the background keeps a tint of the same hue.
  const setBlockColor = (block: typeof blockTypes[number], value: string) =>
    themeUpdate({ vars: { ...useTerminalThemeStore.getState().config.vars, [block.rail]: value, [block.color]: blockBackgroundValue(value) } });
  // Drop every block-appearance override so the theme palette supplies them again.
  const resetBlockAppearance = () => {
    const vars = { ...useTerminalThemeStore.getState().config.vars };
    for (const block of blockTypes) {
      delete vars[block.color];
      delete vars[block.rail];
      delete vars[block.enabled];
    }
    return themeUpdate({ vars });
  };

  return (
    <SettingsGroup title={t('Block appearance')}>
      {blockTypes.map(block => {
        const color = config.vars[block.rail] ?? block.defaultRail;
        const customized = config.vars[block.rail] != null;
        const options = blockColorOptions(block.group, color).map(option => ({
          value: option.value,
          swatch: option.value,
          // An untouched block reads as "Default"; presets use their name, a custom theme its hex.
          label: !customized && option.value === color
            ? t('Default')
            : option.key ? t(option.key) : option.value.toUpperCase(),
        }));
        return <Field key={block.color} title={block.title}
          description={t('Adjust this block background and rail; turning it off hides both.')}>
          <div className="block-appearance-controls">
            <Toggle label={t('Show {{block}} background and rail', { block: block.title })}
              on={config.vars[block.enabled] == null ? block.defaultEnabled : config.vars[block.enabled] !== '0'}
              onChange={enabled => updateBlockVar(block.enabled, enabled ? '1' : '0')} />
            <Select aria-label={t('Color for {{block}}', { block: block.title })} value={color} options={options}
              onChange={value => { void save(() => setBlockColor(block, value)); }} />
          </div>
        </Field>;
      })}
      <div className="settings-record">
        <OutlineButton type="button" onClick={() => { void save(resetBlockAppearance); }} >{t('Restore default block appearance')}</OutlineButton>
      </div>
    </SettingsGroup>
  );
}
