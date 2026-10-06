import { useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { openPath } from '@tauri-apps/plugin-opener';
import { invoke, exportDiagnostics, setDiagnosticAutoSave, useDiagnosticSettings } from '@platform/diagnostics';
import ErrorBox from '@ui/ErrorBox';
import { Field, btnStyle } from '../components/ui';
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
  return <>
    <Field title="自动保存日志" description="默认关闭。开启后持续保存详细诊断日志，重启后继续生效；关闭后停止写入磁盘。">
      <button role="switch" aria-label="自动保存日志" aria-checked={autoSave} disabled={saving} style={btnStyle} onClick={() => { void saveSetting(() => setDiagnosticAutoSave(!autoSave)); }}>{saving ? '保存中…' : autoSave ? '已开启' : '已关闭'}</button>
      {error && <ErrorBox compact testId="logs-error" style={{ marginTop: 8 }}>{error}</ErrorBox>}
    </Field>
    <Field title="导出日志" description="自动保存关闭时也可导出本次运行的最近记录。包含系统与窗口信息、操作时序、IPC 参数与耗时、终端状态、错误堆栈和后端读写尺寸；密码、密钥和终端/对话正文会过滤。">
      <button style={btnStyle} disabled={exporting} onClick={() => { void exportLog(); }}>{exporting ? '导出中…' : '导出详细日志'}</button>
      {message && <ErrorBox compact tone={message.tone} style={{ marginTop: 8 }}>{message.text}</ErrorBox>}
    </Field>
    <Field title="日志存储" description="本次运行最多保留 2000 条前端和 2000 条后端记录；自动保存每个文件最多 5 MB，保留当前文件和两份轮转文件。导出包含保留的自动日志与本次运行记录。">
      <button style={btnStyle} onClick={() => { void invoke<string>('diagnostics_log_directory').then(async path => { setDirectory(path); await openPath(path); }).catch(cause => setMessage({ text: `打开日志目录失败：${String(cause)}`, tone: 'error' })); }}>打开日志目录</button>
      {directory && <p style={{ color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{directory}</p>}
    </Field>
  </>;
}
