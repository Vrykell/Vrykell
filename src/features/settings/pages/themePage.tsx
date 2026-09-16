/**
 * themePage — 外观主题设置页（明暗/不透明度/壁纸/导入导出）。
 */
import { useEffect, useState } from 'react';
import { Sun, Moon, Image as ImageIcon, Download, Upload, RefreshCw, FileText, Trash2 } from 'lucide-react';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { openPath } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';
import { useTheme } from '@/theme/ThemeProvider';
import { useTerminalThemeStore } from '@/theme/terminalTheme';
import { useToastStore } from '@/components/Toast';
import { Field, btnStyle } from '@features/settings/components/ui';

export function ThemePage() {
  const { mode, setMode } = useTheme();
  const config = useTerminalThemeStore((s) => s.config);
  const themeUpdate = useTerminalThemeStore((s) => s.update);
  const exportTo = useTerminalThemeStore((s) => s.exportTo);
  const importFrom = useTerminalThemeStore((s) => s.importFrom);
  const reloadTheme = useTerminalThemeStore((s) => s.load);
  const [themePath, setThemePath] = useState('');

  useEffect(() => {
    invoke<string>('get_theme_path').then(setThemePath).catch((e) => console.warn('[theme] 读取主题路径失败:', e));
  }, []);

  const toast = (msg: string, type: 'info' | 'success' | 'error') =>
    useToastStore.getState().addToast(msg, type);

  const pickBackground = async () => {
    try {
      const sel = await openDialog({ multiple: false });
      if (typeof sel === 'string') {
        await themeUpdate({ backgroundImage: sel });
        toast('已设置背景图片', 'success');
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
      <Field title="主题" description="选择界面明暗外观。">
        <div style={{ display: 'flex', gap: 8 }}>
          {(['dark', 'light'] as const).map((m) => {
            const active = mode === m;
            const Icon = m === 'dark' ? Moon : Sun;
            return (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '10px 16px', fontSize: 12, cursor: 'pointer',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius-inner)', background: active ? 'var(--hover)' : 'transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}
              >
                <Icon size={14} /> {m === 'dark' ? '深色' : '浅色'}
              </button>
            );
          })}
        </div>
      </Field>

      <Field title="应用不透明度" description="整个应用内容的不透明度，数值越低背景壁纸越透出。">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={config.opacity}
            onChange={(e) => void themeUpdate({ opacity: Number(e.target.value) })}
            style={{ flex: 1, accentColor: 'var(--accent-warm)' }}
          />
          <span style={{
            fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)',
            minWidth: 40, textAlign: 'right',
          }}>
            {Math.round(config.opacity * 100)}%
          </span>
        </div>
      </Field>

      <Field title="应用背景图片" description="选择一张图片作为应用壁纸。">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={() => void pickBackground()} style={btnStyle}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <ImageIcon size={13} /> 选择图片
            </span>
          </button>
          {config.backgroundImage && (
            <button onClick={() => void clearBackground()} style={btnStyle}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Trash2 size={13} /> 清除图片
              </span>
            </button>
          )}
        </div>
        {config.backgroundImage && (
          <div style={{
            marginTop: 8, fontSize: 11, color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)', wordBreak: 'break-all',
          }}>
            {config.backgroundImage}
          </div>
        )}
      </Field>

      <Field title="主题导入 / 导出" description="把当前主题外观导出为 JSON，或从 JSON 导入。">
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => void doExport()} style={btnStyle}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Download size={13} /> 导出主题
            </span>
          </button>
          <button onClick={() => void doImport()} style={btnStyle}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Upload size={13} /> 导入主题
            </span>
          </button>
        </div>
      </Field>

      <Field title="配置文件" description="主题外观持久化在 theme.json，可手动编辑 vars 覆盖 CSS 变量。">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => void openConfig()} style={btnStyle}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <FileText size={13} /> 打开配置文件
            </span>
          </button>
          <button onClick={() => void reloadTheme()} style={btnStyle}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <RefreshCw size={13} /> 重新加载
            </span>
          </button>
          {themePath && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
              {themePath}
            </span>
          )}
        </div>
      </Field>
    </>
  );
}
