import { t } from '@i18n';
import { TextInput } from '@ui/TextInput';
import { useReloadFeedback } from '@ui/useReloadFeedback';
/**
 * Appearance, typography, wallpaper and theme files.
 */
import { useEffect, useState } from 'react';
import { themes } from '@config/theme/tokens';
import type { ThemePreference } from '@config/theme/tokens';
import { iconSizes, Image as ImageIcon, Download, Upload, RefreshCw, FileText, Trash2  } from '@ui/icons';
import Select from '@ui/Select';
import { blockBackgroundValue, blockColorOptions, type BlockColorGroup } from '../model/blockColors';
import FontSettings from '@features/settings/components/FontSettings';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { openPath } from '@tauri-apps/plugin-opener';
import { invoke } from '@platform/diagnostics';
import { useTheme } from '@app/providers/ThemeProvider';
import { useTerminalThemeStore } from '@features/settings/model/terminalTheme';
import { useToastStore } from '@ui/Toast';
import { SettingsGroup, Field, Toggle, btnStyle } from '@features/settings/components/ui';
import { useSettingsSave } from '../components/SettingsSaveProvider';
import { isWallpaperImage, wallpaperExtensions } from '../services/wallpaper';

/** Appearance choices offered in order; 'system' follows the operating system. */
const THEME_PREFERENCES: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Follow system' },
];

export function ThemePage() {
  const { mode, preference, setMode } = useTheme();
  const config = useTerminalThemeStore((s) => s.config);
  const themeUpdate = useTerminalThemeStore((s) => s.update);
  const exportTo = useTerminalThemeStore((s) => s.exportTo);
  const importFrom = useTerminalThemeStore((s) => s.importFrom);
  const reloadTheme = useTerminalThemeStore((s) => s.load);
  const reload = useReloadFeedback(reloadTheme);
  const [themePath, setThemePath] = useState('');
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

  useEffect(() => {
    invoke<string>('get_theme_path').then(setThemePath).catch((e) => console.warn('[theme] 读取主题路径失败:', e));
  }, []);

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
      toast('已清除背景图片', 'success');
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    }
  };

  const doExport = async () => {
    try {
      const path = await saveDialog({ defaultPath: 'vrykell-theme.json' });
      if (path) {
        await exportTo(path);
        toast('主题已导出', 'success');
      }
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    }
  };

  const doImport = async () => {
    try {
      const sel = await openDialog({ multiple: false });
      if (typeof sel === 'string') {
        await importFrom(sel);
        toast('主题已导入', 'success');
      }
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    }
  };

  const openConfig = async () => {
    if (!themePath) return;
    try {
      await openPath(themePath);
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    }
  };

  return (
    <>
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


        <Field title="应用不透明度" description={t('Lower opacity reveals more of the wallpaper.')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <TextInput
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={config.opacity}
              onChange={(e) => { const opacity = Number(e.target.value); void save(() => themeUpdate({ opacity })); }}
              style={{ flex: 1, accentColor: 'var(--accent-warm)' }}
            />
            <span style={{
              fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)',
              minWidth: 40, textAlign: 'right',
            }}>
              {Math.round(config.opacity * 100)}%
            </span>
          </div>
        </Field>

        <Field title="应用背景图片" description={t('Choose an application wallpaper.')}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={() => void pickBackground()} style={btnStyle}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <ImageIcon size={iconSizes.control} /> 选择图片
              </span>
            </button>
            {config.backgroundImage && (
              <button onClick={() => void clearBackground()} style={btnStyle}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Trash2 size={iconSizes.control} /> 清除图片
                </span>
              </button>
            )}
          </div>
          {config.backgroundImage && (
            <div style={{
              marginTop: 8, fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)', wordBreak: 'break-all',
            }}>
              {config.backgroundImage}
            </div>
          )}
        </Field>

      </SettingsGroup>
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
          <button type="button" onClick={() => { void save(resetBlockAppearance); }} style={btnStyle}>{t('Restore default block appearance')}</button>
        </div>
      </SettingsGroup>
      <FontSettings />
      <SettingsGroup title={t('Theme files')}>
        <Field title="主题导入 / 导出" description={t('Save or load a theme as JSON.')}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => void doExport()} style={btnStyle}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Download size={iconSizes.control} /> 导出主题
              </span>
            </button>
            <button onClick={() => void doImport()} style={btnStyle}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Upload size={iconSizes.control} /> 导入主题
              </span>
            </button>
          </div>
        </Field>

        <Field layout="stacked" title="配置文件" description={t('Edit theme.json to customize theme variables.')}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => void openConfig()} style={btnStyle}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <FileText size={iconSizes.control} /> 打开配置文件
              </span>
            </button>
            <button onClick={() => void reload.run()} disabled={reload.busy} aria-busy={reload.busy} style={btnStyle}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <RefreshCw size={iconSizes.control} className={reload.busy ? 'reload-spin' : undefined} /> {t('Reload')}
              </span>
            </button>
            {themePath && (
              <span style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                {themePath}
              </span>
            )}
          </div>
        </Field>
      </SettingsGroup>
    </>
  );
}
