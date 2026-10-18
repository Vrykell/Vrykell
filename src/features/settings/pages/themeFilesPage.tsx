/**
 * Theme files: JSON import/export, the theme config file and reloading it.
 */
import { OutlineButton } from '@ui/OutlineButton';
import { t } from '@i18n';
import { useReloadFeedback } from '@ui/useReloadFeedback';
import { useEffect, useState } from 'react';
import { iconSizes, Download, Upload, RefreshCw, FileText } from '@ui/icons';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { openPath } from '@tauri-apps/plugin-opener';
import { getThemePath, useTerminalThemeStore } from '@features/settings/model/terminalTheme';
import { useToastStore } from '@ui/Toast';
import { SettingsGroup, Field } from '@features/settings/components/ui';

export function ThemeFilesPage() {
  const exportTo = useTerminalThemeStore((s) => s.exportTo);
  const importFrom = useTerminalThemeStore((s) => s.importFrom);
  const reloadTheme = useTerminalThemeStore((s) => s.load);
  const reload = useReloadFeedback(reloadTheme);
  const [themePath, setThemePath] = useState('');

  useEffect(() => {
    getThemePath().then(setThemePath).catch((e) => console.warn('[theme] failed to read theme path:', e));
  }, []);

  const toast = (msg: string, type: 'info' | 'success' | 'error') =>
    useToastStore.getState().addToast(msg, type);

  const doExport = async () => {
    try {
      const path = await saveDialog({ defaultPath: 'vrykell-theme.json' });
      if (path) {
        await exportTo(path);
        toast(t('Theme exported'), 'success');
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
        toast(t('Theme imported'), 'success');
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
    <SettingsGroup title={t('Theme files')}>
      <Field title={t('Import / export theme')} description={t('Save or load a theme as JSON.')}>
        <div style={{ display: 'flex', gap: 8 }}>
          <OutlineButton onClick={() => void doExport()} >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Download size={iconSizes.control} /> {t('Export theme')}
            </span>
          </OutlineButton>
          <OutlineButton onClick={() => void doImport()} >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Upload size={iconSizes.control} /> {t('Import theme')}
            </span>
          </OutlineButton>
        </div>
      </Field>

      <Field layout="stacked" title={t('Config file')} description={t('Edit theme.json to customize theme variables.')}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <OutlineButton onClick={() => void openConfig()} >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <FileText size={iconSizes.control} /> {t('Open config file')}
            </span>
          </OutlineButton>
          <OutlineButton onClick={() => void reload.run()} disabled={reload.busy} aria-busy={reload.busy} >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <RefreshCw size={iconSizes.control} className={reload.busy ? 'reload-spin' : undefined} /> {t('Reload')}
            </span>
          </OutlineButton>
          {themePath && (
            <span style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)', fontFamily: 'var(--font-ui)', wordBreak: 'break-all' }}>
              {themePath}
            </span>
          )}
        </div>
      </Field>
    </SettingsGroup>
  );
}
