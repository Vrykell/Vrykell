import { t } from '@i18n';
import { TextInput } from '@ui/TextInput';
/**
 * themePage — 外观主题设置页（明暗/不透明度/壁纸/导入导出）。
 */
import { useEffect, useState } from 'react';
import { iconSizes, Sun, Moon, Image as ImageIcon, Download, Upload, RefreshCw, FileText, Trash2  } from '@ui/icons';
import FontSettings from '@features/settings/components/FontSettings';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { openPath } from '@tauri-apps/plugin-opener';
import { invoke } from '@platform/diagnostics';
import { useTheme } from '@app/providers/ThemeProvider';
import { useTerminalThemeStore } from '@features/settings/model/terminalTheme';
import { useToastStore } from '@ui/Toast';
import { Field, btnStyle } from '@features/settings/components/ui';
import { useSettingsSave } from '../components/SettingsSaveProvider';
import { isWallpaperImage, wallpaperExtensions } from '../services/wallpaper';

export function ThemePage() {
  const { mode, setMode } = useTheme();
  const config = useTerminalThemeStore((s) => s.config);
  const themeUpdate = useTerminalThemeStore((s) => s.update);
  const exportTo = useTerminalThemeStore((s) => s.exportTo);
  const importFrom = useTerminalThemeStore((s) => s.importFrom);
  const reloadTheme = useTerminalThemeStore((s) => s.load);
  const [themePath, setThemePath] = useState('');
  const { save } = useSettingsSave();

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
      <Field title="主题" description={t('Choose a light or dark appearance.')}>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['dark', 'light'] as const).map((m) => {
            const active = mode === m;
            const Icon = m === 'dark' ? Moon : Sun;
            return (
              <button
                key={m}
                aria-pressed={active}
                onClick={() => { void save(() => setMode(m)); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '10px 16px', fontSize: 'calc(12px * var(--ui-font-scale))', cursor: 'pointer',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius-inner)', background: active ? 'var(--hover)' : 'transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}
              >
                <Icon size={iconSizes.control} /> {m === 'dark' ? '深色' : '浅色'}
              </button>
            );
          })}
        </div>
      </Field>

      <FontSettings />

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

      <Field title="配置文件" description={t('Edit theme.json to customize theme variables.')}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => void openConfig()} style={btnStyle}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <FileText size={iconSizes.control} /> 打开配置文件
            </span>
          </button>
          <button onClick={() => void reloadTheme()} style={btnStyle}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <RefreshCw size={iconSizes.control} /> 重新加载
            </span>
          </button>
          {themePath && (
            <span style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
              {themePath}
            </span>
          )}
        </div>
      </Field>
    </>
  );
}
