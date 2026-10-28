/**
 * Base appearance: theme mode, application opacity and wallpaper.
 */
import { OutlineButton } from '@ui/actions/OutlineButton';
import { t } from '@i18n';
import { RangeInput } from '@ui/fields/RangeInput';
import SegmentedControl from '@ui/fields/SegmentedControl';
import type { ThemePreference } from '@config/theme/tokens';
import { iconSizes, Image as ImageIcon, Trash2 } from '@ui/icons';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useTheme } from '@app/providers/ThemeProvider';
import { supportsNativeMaterial } from '@platform/runtime';
import { useTerminalThemeStore } from '@features/settings/model/terminalTheme';
import { useToastStore } from '@ui/feedback/Toast';
import { SettingsGroup, Field, Toggle } from '@features/settings/components/ui';
import { useSettingsSave } from '../components/SettingsSaveProvider';
import { isWallpaperImage, wallpaperExtensions } from '../services/wallpaper';
import { ThemePresetPicker } from '../components/ThemePresetPicker';

/** Appearance choices offered in order; 'system' follows the operating system. */
const THEME_PREFERENCES: { value: ThemePreference; label: string }[] = [
  { value: 'dark', label: 'Always dark' },
  { value: 'light', label: 'Always light' },
  { value: 'system', label: 'Follow system' },
];

export function ThemePage() {
  const { mode, preference, setMode } = useTheme();
  const displayedMode = preference === 'system' ? mode : preference;
  const config = useTerminalThemeStore((s) => s.config);
  const themeUpdate = useTerminalThemeStore((s) => s.update);
  const { save } = useSettingsSave();

  const toast = (msg: string, type: 'info' | 'success' | 'error') =>
    useToastStore.getState().addToast(msg, type);

  const pickBackground = async () => {
    try {
      const sel = await openDialog({ multiple: false, directory: false,
        filters: [{ name: t('Images'), extensions: wallpaperExtensions }] });
      if (typeof sel === 'string') {
        if (!await isWallpaperImage(sel)) {
          toast(t('Choose a valid image file.'), 'error');
          return;
        }
        await themeUpdate({ backgroundImage: sel });
        toast(t('Wallpaper updated.'), 'success');
      }
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    }
  };

  const clearBackground = async () => {
    try {
      await themeUpdate({ backgroundImage: null });
      toast(t('Wallpaper cleared'), 'success');
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    }
  };

  return (
    <SettingsGroup title={t('Appearance')}>
      <Field title={t('Theme mode')} description={t('Choose a light or dark appearance.')}>
        <SegmentedControl label={t('Theme mode')} value={preference}
          options={THEME_PREFERENCES.map(option => ({ ...option, label: t(option.label) }))}
          onChange={value => { void save(() => setMode(value)); }} />
      </Field>

      <Field title={t(displayedMode === 'dark' ? 'Dark color scheme' : 'Light color scheme')}
        description={t('Apply a color scheme to the interface, editor and terminal.')} layout="stacked">
        <ThemePresetPicker mode={displayedMode} value={config[`${displayedMode}Preset`]}
          onChange={id => { void save(() => themeUpdate({ [`${displayedMode}Preset`]: id })); }} />
      </Field>
      {Object.keys(config.vars).length > 0 && <Field title={t('Custom colors')} description={t('Your custom colors remain applied.')}>
        <span>{t('Enabled')}</span>
      </Field>}

      {supportsNativeMaterial && (
        <Field title={t('Desktop material')} description={t('Use acrylic material in the left sidebar. Other regions stay opaque.')}>
          <Toggle label={t('Desktop material')} on={config.desktopTint ?? true} onChange={desktopTint => themeUpdate({ desktopTint })} />
        </Field>
      )}

      <Field title={t('Application opacity')} description={t('Lower opacity reveals more of the wallpaper.')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <RangeInput
            aria-label={t('Application opacity')}
            min={0.5}
            max={1}
            step={0.05}
            value={config.opacity}
            onChange={(e) => { const opacity = Number(e.target.value); void save(() => themeUpdate({ opacity })); }}
            style={{ flex: 1 }}
          />
          <span style={{
            fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-secondary)', fontFamily: 'var(--font-ui)',
            minWidth: 40, textAlign: 'right',
          }}>
            {Math.round(config.opacity * 100)}%
          </span>
        </div>
      </Field>

      <Field title={t('Application background image')} description={t('Choose an application wallpaper.')}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <OutlineButton onClick={() => void pickBackground()} >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <ImageIcon size={iconSizes.control} /> {t('Choose image')}
            </span>
          </OutlineButton>
          {config.backgroundImage && (
            <OutlineButton onClick={() => void clearBackground()} >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Trash2 size={iconSizes.control} /> {t('Clear image')}
              </span>
            </OutlineButton>
          )}
        </div>
        {config.backgroundImage && (
          <div style={{
            marginTop: 8, fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)',
            fontFamily: 'var(--font-ui)', wordBreak: 'break-all',
          }}>
            {config.backgroundImage}
          </div>
        )}
      </Field>
    </SettingsGroup>
  );
}
