import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Download, FolderOpen, RefreshCw, Trash2, Upload } from '@ui/icons';
import { TerminalProfileIcon } from '@ui/shellIcons';
import { ProgressBar } from '@ui/ProgressBar';
import { OutlineButton } from '@ui/OutlineButton';
import { TextButton } from '@ui/TextButton';
import { IconBtn, fmtSize } from '@ui/UiBtn';
import ErrorBox from '@ui/ErrorBox';
import ConfirmDialog from '@ui/ConfirmDialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { useToastStore } from '@ui/Toast';
import { t, type I18nKey } from '@i18n';
import { downloadsList, downloadsDelete, type DownloadEntry } from '../services/downloads';
import { transfersList, transfersClear, transfersControl, transfersDelete, transferPercent, type TransferJob, type TransferStatus } from '../services/transfers';
import { fileIcon } from '../utils/fileIcon';
import './TransferManagerView.css';

const statusLabels: Record<TransferStatus, I18nKey> = {
  running: 'Transferring', paused: 'Transfer paused', interrupted: 'Transfer interrupted',
  failed: 'Transfer failed', cancelled: 'Transfer cancelled', completed: 'Transfer completed',
};
type TransferAction = 'pause' | 'resume' | 'cancel';
interface TransferRecord { job: TransferJob; history?: DownloadEntry }

function TransferCard({ record: { job, history }, pending, onControl, onDelete, onReveal }: {
  record: TransferRecord;
  pending: boolean;
  onControl: (job: TransferJob, action: TransferAction) => void;
  onDelete: () => void;
  onReveal: (path: string) => void;
}) {
  const FileIcon = fileIcon(job.name, job.isDir);
  const completed = job.status === 'completed';
  const percent = Math.floor(transferPercent(job));
  const preparing = job.status === 'running' && job.total === 0;
  const source = job.direction === 'upload' ? job.localPath : job.remotePath;
  const destination = job.direction === 'upload' ? job.remotePath : job.localPath;
  return <article className={`transfer-record${history ? ' transfer-record-history' : ''}`} data-status={job.status}
    data-testid={history ? 'download-item-' + history.name : 'transfer-' + job.id} aria-label={job.name} aria-busy={pending}>
    <div className="transfer-record-title">
      <FileIcon size={16} aria-hidden="true" />
      <span className="transfer-file-name" data-tip={job.name}>{job.name}</span>
    </div>
    <div className="transfer-connection"><TerminalProfileIcon kind="ssh" connectionId={job.connectionId} size={16} /><span data-tip={job.connectionName}>{job.connectionName}</span></div>
    <dl className="transfer-paths">
      <div><dt>{t('Transfer source')}</dt><dd data-tip={source}>{source}</dd></div>
      <div><dt>{t('Transfer destination')}</dt><dd data-tip={destination}>{destination}</dd></div>
    </dl>
    <div className="transfer-progress-heading">
      <span className="transfer-status">{completed ? <CheckCircle2 size={13} aria-hidden="true" /> : <i aria-hidden="true" />}{t(preparing ? 'Preparing transfer…' : statusLabels[job.status])}</span>
      {!completed && !preparing && <span className="transfer-percent">{percent}%</span>}
      {completed && <span>{fmtSize(Math.max(job.bytes, job.total))}</span>}
    </div>
    {!completed && <>
      <ProgressBar label={t('Transfer progress')} value={transferPercent(job)} />
      <div className="transfer-metrics"><span>{fmtSize(job.bytes)}{job.total > 0 && <> / {fmtSize(job.total)}</>}</span>
        {job.status === 'running' && job.speed > 0 && <span>{fmtSize(job.speed)}/s</span>}
      </div>
      {job.status === 'running' && job.speed > 0 && job.total > job.bytes && <div className="transfer-eta">
        {t('About {{seconds}} seconds remaining', { seconds: Math.ceil((job.total - job.bytes) / job.speed) })}
      </div>}
    </>}
    {job.error && job.status === 'failed' && <ErrorBox compact>{job.error}</ErrorBox>}
    <div className="transfer-record-footer">
      {!completed && <div className="transfer-controls" data-testid={'transfer-controls-' + job.id}>
        {job.status === 'running'
          ? <OutlineButton disabled={pending} onClick={() => onControl(job, 'pause')}>{t('Pause transfer')}</OutlineButton>
          : <OutlineButton disabled={pending} onClick={() => onControl(job, 'resume')}>{t('Resume transfer')}</OutlineButton>}
        {job.status !== 'cancelled' && <TextButton aria-label={t('Cancel transfer')} disabled={pending} onClick={() => onControl(job, 'cancel')}>{t('Cancel')}</TextButton>}
      </div>}
      {history && <time className="transfer-date" dateTime={new Date(history.downloadedAt).toISOString()} data-tip={new Date(history.downloadedAt).toLocaleString()}>{new Date(history.downloadedAt).toLocaleDateString()}</time>}
      <div className="transfer-actions">
        {completed && job.direction === 'download' && <IconBtn compact className="transfer-action" title={t('Reveal downloaded file')}
          data-testid={history ? 'download-reveal-' + history.name : 'transfer-reveal-' + job.id} onClick={() => onReveal(job.localPath)}><FolderOpen size={14} /></IconBtn>}
        <IconBtn compact tone="danger" className="transfer-action" title={t('Delete transfer record')}
          data-testid={history ? 'download-delete-' + history.id : 'transfer-delete-' + job.id} disabled={pending} onClick={onDelete}><Trash2 size={14} /></IconBtn>
      </div>
    </div>
  </article>;
}

export default function TransferManagerView({ onBack, direction }: { onBack: () => void; direction: 'upload' | 'download' }) {
  const [jobs, setJobs] = useState<TransferJob[]>([]);
  const [history, setHistory] = useState<DownloadEntry[]>([]);
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(direction !== 'download');
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [revision, setRevision] = useState(0);
  const [historyRevision, setHistoryRevision] = useState(0);
  const toast = (message: string) => useToastStore.getState().addToast(message, 'error');
  useEffect(() => {
    if (direction !== 'download') return;
    let disposed = false;
    void downloadsList().then(next => { if (!disposed) { setHistory(next); setHistoryError(''); } })
      .catch(e => { if (!disposed) setHistoryError(String(e)); })
      .finally(() => { if (!disposed) setHistoryLoaded(true); });
    return () => { disposed = true; };
  }, [direction, historyRevision]);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const next = await transfersList(); if (!disposed) { setJobs(next); setError(''); } }
      catch (e) { if (!disposed) setError(String(e)); }
      finally { if (!disposed) { setJobsLoaded(true); timer = setTimeout(() => { void poll(); }, 750); } }
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [revision]);
  const updatePending = (id: string, busy: boolean) => setPending(current => {
    const next = new Set(current);
    if (busy) next.add(id); else next.delete(id);
    return next;
  });
  const control = async (job: TransferJob, action: TransferAction) => {
    updatePending(job.id, true);
    try { await transfersControl(job.id, action); setRevision(v => v + 1); }
    catch (e) { toast(String(e)); }
    finally { updatePending(job.id, false); }
  };
  const reveal = (path: string) => { void revealItemInDir(path).catch(e => toast(String(e))); };
  const deleteRecord = async ({ job, history: entry }: TransferRecord) => {
    updatePending(job.id, true);
    try {
      if (entry) { await downloadsDelete(entry.id); setHistoryRevision(v => v + 1); }
      else { await transfersDelete(job.id); setRevision(v => v + 1); if (direction === 'download') setHistoryRevision(v => v + 1); }
    } catch (e) { toast(String(e)); }
    finally { updatePending(job.id, false); }
  };
  const clearCompleted = async () => {
    setConfirmClear(false);
    setClearing(true);
    try { await transfersClear(direction); setHistoryRevision(v => v + 1); setRevision(v => v + 1); }
    catch (e) { toast(String(e)); }
    finally { setClearing(false); }
  };
  const visible: TransferRecord[] = jobs.filter(job => job.direction === direction).map(job => ({ job }));
  if (direction === 'download' && jobsLoaded) {
    for (const entry of history) {
      if (visible.some(({ job }) => job.localPath === entry.localPath)) continue;
      visible.push({ history: entry, job: {
        id: `history-${entry.id}`, connectionId: '', connectionName: entry.connectionName, direction: 'download',
        name: entry.name, localPath: entry.localPath, remotePath: entry.remotePath, isDir: entry.isDir,
        status: 'completed', bytes: entry.size, total: entry.size, speed: 0, error: '', createdAt: entry.downloadedAt,
      } });
    }
  }
  visible.sort((a, b) => b.job.createdAt - a.job.createdAt);
  const groups: { id: string; label: I18nKey; records: TransferRecord[] }[] = [
    { id: 'ongoing', label: 'Ongoing transfers', records: visible.filter(({ job }) => job.status === 'running' || job.status === 'paused') },
    { id: 'stopped', label: 'Stopped transfers', records: visible.filter(({ job }) => ['interrupted', 'failed', 'cancelled'].includes(job.status)) },
    { id: 'completed', label: 'Completed transfers', records: visible.filter(({ job }) => job.status === 'completed') },
  ];
  const loading = !jobsLoaded || !historyLoaded;
  const DirectionIcon = direction === 'upload' ? Upload : Download;
  return <div className="transfer-manager" data-testid={`${direction}-manager`}>
    <div className="sidebar-heading transfer-manager-heading">
      <IconBtn compact title={t('Back to files')} data-testid="downloads-back" onClick={onBack}><ArrowLeft size={14} /></IconBtn>
      <span>{t(direction === 'upload' ? 'Upload manager' : 'Download manager')}</span>
      {groups[2].records.length > 0 && <IconBtn compact title={t('Clear completed transfers')} data-testid="downloads-clear" disabled={clearing} onClick={() => setConfirmClear(true)}><Trash2 size={14} /></IconBtn>}
    </div>
    <div className="transfer-manager-body">
      {(error || historyError) && <ErrorBox actions={<OutlineButton onClick={() => { setHistoryRevision(v => v + 1); setRevision(v => v + 1); }}>{t('Retry')}</OutlineButton>}>{error || historyError}</ErrorBox>}
      {loading && visible.length === 0 && !error && !historyError && <div className="transfer-empty" role="status"><RefreshCw size={20} className="reload-spin" aria-hidden="true" />{t('Loading transfers…')}</div>}
      {!loading && !error && !historyError && visible.length === 0 && <div className="transfer-empty">
        <DirectionIcon size={28} aria-hidden="true" />
        <strong>{t('No transfer records')}</strong>
        <p>{t(direction === 'upload' ? 'Upload files or folders from a remote file panel to see their progress here.' : 'Download files or folders from a remote file panel to see their progress here.')}</p>
        <OutlineButton onClick={onBack}>{t('Back to files')}</OutlineButton>
      </div>}
      {groups.filter(group => group.records.length > 0).map(group => <section key={group.id} className="transfer-group" aria-label={t(group.label)} data-testid={'transfers-group-' + group.id}>
        <h3>{t(group.label)}<span aria-hidden="true">{group.records.length}</span></h3>
        {group.records.map(record => <TransferCard key={record.job.id} record={record} pending={pending.has(record.job.id)}
          onControl={(job, action) => void control(job, action)} onDelete={() => void deleteRecord(record)} onReveal={reveal} />)}
      </section>)}
    </div>
    <ConfirmDialog open={confirmClear} title={t('Clear completed transfers')} message={t('Clear completed transfer records without deleting files?')}
      confirmLabel={t('Clear completed transfers')} onCancel={() => setConfirmClear(false)} onConfirm={() => void clearCompleted()} />
  </div>;
}
