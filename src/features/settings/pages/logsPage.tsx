import { t } from '@i18n';
import { useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { openPath } from '@tauri-apps/plugin-opener';
import { invoke, exportDiagnostics, setDiagnosticAutoSave, useDiagnosticSettings } from '@platform/diagnostics';
import ErrorBox from '@ui/ErrorBox';
import { SettingsGroup, Field, btnStyle } from '../components/ui';
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
      const path = await save({ title: '导出详细诊断日志', defaultPath: `vrykell-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`, filters: [{ name: '诊断日志', extensions: ['jsonl'] }] });
      if (path) { await exportDiagnostics(path); setMessage({ text: `已导出到 ${path}`, tone: 'success' }); }
    } catch (cause) { setMessage({ text: `导出失败：${String(cause)}`, tone: 'error' }); }
    finally { setExporting(false); }
  };
  return <SettingsGroup title={t('Diagnostics')}>
    <Field title="自动保存日志" description={t('Save diagnostics on this device across restarts.')}>
      <button role="switch" aria-label="自动保存日志" aria-checked={autoSave} disabled={saving} style={btnStyle} onClick={() => { void saveSetting(() => setDiagnosticAutoSave(!autoSave)); }}>{saving ? '保存中…' : autoSave ? '已开启' : '已关闭'}</button>
      {error && <ErrorBox compact testId="logs-error" style={{ marginTop: 8 }}>{error}</ErrorBox>}
    </Field>
    <Field title="导出日志" description={t('Export recent diagnostics. Passwords, keys and terminal or conversation content are excluded.')}>
      <button style={btnStyle} disabled={exporting} onClick={() => { void exportLog(); }}>{exporting ? '导出中…' : '导出详细日志'}</button>
      {message && <ErrorBox compact tone={message.tone} testId="logs-export-status" style={{ marginTop: 8 }}>{message.text}</ErrorBox>}
    </Field>
    <Field title="日志存储" description={t('Files rotate at 5 MB. Keep the current file and two backups.')}>
      <button style={btnStyle} onClick={() => { void invoke<string>('diagnostics_log_directory').then(async path => { setDirectory(path); await openPath(path); }).catch(cause => setMessage({ text: `打开日志目录失败：${String(cause)}`, tone: 'error' })); }}>打开日志目录</button>
      {directory && <p style={{ color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{directory}</p>}
    </Field>
  </SettingsGroup>;
}
