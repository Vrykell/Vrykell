/**
 * Base appearance: theme mode, application opacity and wallpaper.
 */
import { OutlineButton } from '@ui/OutlineButton';
import { t } from '@i18n';
import { TextInput } from '@ui/TextInput';
import type { ThemePreference } from '@config/theme/tokens';
import { iconSizes, Image as ImageIcon, Trash2 } from '@ui/icons';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useTheme } from '@app/providers/ThemeProvider';
import { useTerminalThemeStore } from '@features/settings/model/terminalTheme';
import { useToastStore } from '@ui/Toast';
import { SettingsGroup, Field } from '@features/settings/components/ui';
import { useSettingsSave } from '../components/SettingsSaveProvider';
import { isWallpaperImage, wallpaperExtensions } from '../services/wallpaper';

/** Appearance choices offered in order; 'system' follows the operating system. */
const THEME_PREFERENCES: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Follow system' },
];

export function ThemePage() {
  const { preference, setMode } = useTheme();
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
        <div className="settings-radio-group" role="radiogroup" aria-label={t('Theme mode')}>
          {THEME_PREFERENCES.map(option => {
            const active = preference === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                className="settings-radio"
                data-on={active || undefined}
                onClick={() => { void save(() => setMode(option.value)); }}
              >
                <span className="settings-radio-dot" aria-hidden="true"
                  data-system={option.value === 'system' && preference === 'system' ? 'true' : undefined} />
                {t(option.label)}
              </button>
            );
          })}
        </div>
      </Field>

      <Field title={t('Application opacity')} description={t('Lower opacity reveals more of the wallpaper.')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <TextInput
            type="range"
            min={0.5}
            max={1}
            step={0.05}
            value={config.opacity}
            onChange={(e) => { const opacity = Number(e.target.value); void save(() => themeUpdate({ opacity })); }}
            style={{ flex: 1, accentColor: 'var(--accent-warm)' }}
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
