import { ProgressBar } from '@ui/ProgressBar';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, FolderOpen, Trash2 } from '@ui/icons';
import { OutlineButton } from '@ui/OutlineButton';
import { IconBtn, fmtSize } from '@ui/UiBtn';
import ErrorBox from '@ui/ErrorBox';
import ConfirmDialog from '@ui/ConfirmDialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { useToastStore } from '@ui/Toast';
import { t, type I18nKey } from '@i18n';
import { downloadsList, downloadsDelete, type DownloadEntry } from '../services/downloads';
import { transfersList, transfersClear, transfersControl, transfersDelete, transferPercent, type TransferJob, type TransferStatus } from '../services/transfers';

const statusLabels: Record<TransferStatus, I18nKey> = {
  running: 'Transferring', paused: 'Transfer paused', interrupted: 'Transfer interrupted',
  failed: 'Transfer failed', cancelled: 'Transfer cancelled', completed: 'Transfer completed',
};

export default function TransferManagerView({ onBack, direction }: { onBack: () => void; direction: 'upload' | 'download' }) {
  const [jobs, setJobs] = useState<TransferJob[]>([]);
  const [history, setHistory] = useState<DownloadEntry[]>([]);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const toast = (message: string) => useToastStore.getState().addToast(message, 'error');
  const loadHistory = useCallback(() => {
    if (direction !== 'download') return;
    setHistoryError('');
    void downloadsList().then(setHistory).catch(e => setHistoryError(String(e)));
  }, [direction]);
  const [revision, setRevision] = useState(0);
  useEffect(loadHistory, [loadHistory]);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const next = await transfersList(); if (!disposed) { setJobs(next); setError(''); } }
      catch (e) { if (!disposed) setError(String(e)); }
      finally { if (!disposed) timer = setTimeout(() => { void poll(); }, 750); }
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [revision]);
  const control = async (job: TransferJob, action: 'pause' | 'resume' | 'cancel') => {
    setPending(current => new Set(current).add(job.id));
    try { await transfersControl(job.id, action); setRevision(v => v + 1); }
    catch (e) { toast(String(e)); }
    finally { setPending(current => { const next = new Set(current); next.delete(job.id); return next; }); }
  };
  const reveal = (path: string) => { void revealItemInDir(path).catch(e => toast(String(e))); };
  const deleteJob = async (id: string) => {
    setPending(current => new Set(current).add(id));
    try { await transfersDelete(id); setRevision(v => v + 1); }
    catch (e) { toast(String(e)); }
    finally { setPending(current => { const next = new Set(current); next.delete(id); return next; }); }
  };
  const deleteHistory = async (entry: DownloadEntry) => {
    const key = `history-${entry.id}`;
    setPending(current => new Set(current).add(key));
    try { await downloadsDelete(entry.id); loadHistory(); }
    catch (e) { toast(String(e)); }
    finally { setPending(current => { const next = new Set(current); next.delete(key); return next; }); }
  };
  const visible = jobs.filter(job => job.direction === direction);
  const legacy = history.filter(entry => !jobs.some(job => job.direction === 'download' && job.localPath === entry.localPath));
  return <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, color: 'var(--text-primary)' }}>
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, padding: '6px 8px', minHeight: 30 }}>
      <IconBtn title={t('Back to files')} data-testid="downloads-back" onClick={onBack}><ArrowLeft size={14} /></IconBtn>
      <span style={{ fontWeight: 'var(--fw-semibold)', fontSize: 'var(--fs-label)' }}>{t(direction === 'upload' ? 'Upload manager' : 'Download manager')}</span>
      {(visible.some(job => job.status === 'completed') || (direction === 'download' && history.length > 0)) && <IconBtn title={t('Clear completed transfers')} data-testid="downloads-clear" onClick={() => setConfirmClear(true)}><Trash2 size={14} /></IconBtn>}
    </div>
    <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
      {(error || historyError) && <ErrorBox style={{ margin: 8 }} actions={<OutlineButton onClick={() => { loadHistory(); setRevision(v => v + 1); }}>{t('Retry')}</OutlineButton>}>{error || historyError}</ErrorBox>}
      {!error && !historyError && visible.length === 0 && (direction === 'upload' || legacy.length === 0) && <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>{t('No transfer records')}</div>}
      {visible.map(job => <div key={job.id} className="transfer-record" data-testid={'transfer-' + job.id} style={{ padding: '8px 76px 8px 10px', display: 'flex', flexDirection: 'column', gap: 5, fontSize: 'var(--fs-label)' }}>
        <div className="transfer-record-title" style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}><div style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', fontFamily: 'var(--font-mono)' }}>{job.name}</div>
          <div className="transfer-actions">
            {job.status === 'completed' && job.direction === 'download' && <IconBtn className="transfer-action" title={t('Reveal downloaded file')} aria-label={t('Reveal downloaded file')} onClick={() => reveal(job.localPath)}><FolderOpen size={14} /></IconBtn>}
            <IconBtn className="transfer-action" title={t('Delete transfer record')} aria-label={t('Delete transfer record')} data-testid={'transfer-delete-' + job.id} disabled={pending.has(job.id)} onClick={() => void deleteJob(job.id)}><Trash2 size={14} /></IconBtn>
          </div>
        </div>
        {job.status !== 'completed' && <ProgressBar label={t('Transfer progress')} value={transferPercent(job)} />}
        <div style={{ color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
          {t(statusLabels[job.status])} · {fmtSize(job.bytes)} / {fmtSize(job.total)} · {Math.floor(transferPercent(job))}%
          {job.status === 'running' && job.speed > 0 && <span> · {fmtSize(job.speed)}/s · {t('About {{seconds}} seconds remaining', { seconds: Math.ceil(Math.max(0, job.total - job.bytes) / job.speed) })}</span>}
        </div>
        {job.error && job.status === 'failed' && <ErrorBox>{job.error}</ErrorBox>}
        {job.status !== 'completed' && <div data-testid={'transfer-controls-' + job.id} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {job.status === 'running' && <OutlineButton disabled={pending.has(job.id)} onClick={() => void control(job, 'pause')}>{t('Pause transfer')}</OutlineButton>}
          {['paused', 'interrupted', 'failed', 'cancelled'].includes(job.status) && <OutlineButton disabled={pending.has(job.id)} onClick={() => void control(job, 'resume')}>{t('Resume transfer')}</OutlineButton>}
          {['running', 'paused', 'interrupted', 'failed'].includes(job.status) && <OutlineButton disabled={pending.has(job.id)} onClick={() => void control(job, 'cancel')}>{t('Cancel transfer')}</OutlineButton>}
        </div>}
      </div>)}
      {direction === 'download' && legacy.map(entry => <div key={entry.id} className="transfer-record transfer-record-history" data-testid={'download-item-' + entry.name} style={{ display: 'flex', gap: 8, padding: '8px 76px 8px 10px', fontSize: 'var(--fs-label)', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{entry.name}<div style={{ color: 'var(--text-muted)' }}>{fmtSize(entry.size)} · {new Date(entry.downloadedAt).toLocaleString()} · {entry.connectionName}</div></div>
        <div className="transfer-actions">
          <IconBtn className="transfer-action" title={t('Reveal downloaded file')} aria-label={t('Reveal downloaded file')} data-testid={'download-reveal-' + entry.name} onClick={() => reveal(entry.localPath)}><FolderOpen size={14} /></IconBtn>
          <IconBtn className="transfer-action" title={t('Delete transfer record')} aria-label={t('Delete transfer record')} data-testid={'download-delete-' + entry.id} disabled={pending.has(`history-${entry.id}`)} onClick={() => void deleteHistory(entry)}><Trash2 size={14} /></IconBtn>
        </div>
      </div>)}
    </div>
    <ConfirmDialog open={confirmClear} title={t('Clear completed transfers')} message={t('Clear completed transfer records without deleting files?')}
      confirmLabel={t('Clear completed transfers')} onCancel={() => setConfirmClear(false)} onConfirm={() => {
        setConfirmClear(false); void transfersClear(direction).then(() => { loadHistory(); setRevision(v => v + 1); }).catch(e => toast(String(e)));
      }} />
  </div>;
}
