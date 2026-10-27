import { OutlineButton } from '@ui/actions/OutlineButton';
import { t } from '@i18n';
import { useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { openPath } from '@tauri-apps/plugin-opener';
import { diagnosticsLogDirectory, exportDiagnostics, setDiagnosticAutoSave, useDiagnosticSettings } from '@platform/diagnostics';
import ErrorBox from '@ui/feedback/ErrorBox';
import { SettingsGroup, Field } from '../components/ui';
import { useSettingsSave } from '../components/SettingsSaveProvider';

export function LogsPage() {
  const { autoSave, saving, error } = useDiagnosticSettings();
  const { save: saveSetting } = useSettingsSave();
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [directory, setDirectory] = useState('');
  const exportLog = async () => {
    setExporting(true);
    setMessage(null);
    try {
      const path = await save({ title: t('Export detailed diagnostics log'), defaultPath: `vrykell-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`, filters: [{ name: t('Diagnostics log'), extensions: ['jsonl'] }] });
      if (path) { await exportDiagnostics(path); setMessage({ text: t('Exported to {{path}}', { path }), tone: 'success' }); }
    } catch (cause) { setMessage({ text: t('Export failed: {{error}}', { error: String(cause) }), tone: 'error' }); }
    finally { setExporting(false); }
  };
  return <SettingsGroup title={t('Diagnostics')}>
    <Field title={t('Save logs automatically')} description={t('Save diagnostics on this device across restarts.')}>
      <OutlineButton role="switch" aria-label={t('Save logs automatically')} aria-checked={autoSave} disabled={saving} onClick={() => { void saveSetting(() => setDiagnosticAutoSave(!autoSave)); }}>{saving ? t('Saving…') : autoSave ? t('Enabled') : t('Disabled')}</OutlineButton>
      {error && <ErrorBox compact testId="logs-error" style={{ marginTop: 8 }}>{error}</ErrorBox>}
    </Field>
    <Field title={t('Export logs')} description={t('Export recent diagnostics. Passwords, keys and terminal or conversation content are excluded.')}>
      <OutlineButton disabled={exporting} onClick={() => { void exportLog(); }}>{exporting ? t('Exporting…') : t('Export detailed log')}</OutlineButton>
      {message && <ErrorBox compact tone={message.tone} testId="logs-export-status" style={{ marginTop: 8 }}>{message.text}</ErrorBox>}
    </Field>
    <Field title={t('Log storage')} description={t('Files rotate at 5 MB. Keep the current file and two backups.')}>
      <OutlineButton onClick={() => { void diagnosticsLogDirectory().then(async path => { setDirectory(path); await openPath(path); }).catch(cause => setMessage({ text: t('Could not open the log folder: {{error}}', { error: String(cause) }), tone: 'error' })); }}>{t('Open log folder')}</OutlineButton>
      {directory && <p style={{ color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{directory}</p>}
    </Field>
  </SettingsGroup>;
}
