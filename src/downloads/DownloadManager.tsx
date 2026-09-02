import { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, FolderOpen, Trash2 } from 'lucide-react';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { downloadsList, downloadsClear, type DownloadEntry } from './api';
import { fileIcon } from '../files/fileIcon';
import { useToastStore } from '../components/Toast';
import { IconBtn } from '../components/UiBtn';
import ConfirmDialog from '../components/ConfirmDialog';

/** 字节数格式化（B/KB/MB/GB/TB）。 */
function fmtSize(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * DownloadManager — 下载管理页（入口在文件面板顶栏）。
 * 展示下载历史（文件/目录），支持在系统文件管理器中定位，支持清空历史。
 */
export default function DownloadManager({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<DownloadEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);
  const toast = (msg: string, type: 'info' | 'success' | 'error') =>
    useToastStore.getState().addToast(msg, type);

  const load = useCallback(() => {
    setLoading(true);
    downloadsList()
      .then(setItems)
      .catch((e) => toast(String((e as Error)?.message ?? e), 'error'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const reveal = (entry: DownloadEntry) => {
    revealItemInDir(entry.localPath).catch((e) =>
      toast(String((e as Error)?.message ?? e), 'error'),
    );
  };

  const clear = () => {
    downloadsClear()
      .then(() => { toast('已清空下载历史', 'success'); load(); })
      .catch((e) => toast(String((e as Error)?.message ?? e), 'error'));
    setConfirmClear(false);
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      userSelect: 'none', background: 'var(--surface)',
    }}>
      {/* 顶栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 2,
        padding: '6px 8px', borderBottom: '1px solid var(--border)',
        minHeight: 30, flexShrink: 0,
      }}>
        <IconBtn title="返回文件浏览" data-testid="downloads-back" onClick={onBack}>
          <ArrowLeft size={14} />
        </IconBtn>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>下载管理</span>
        <div style={{ flex: 1 }} />
        {items.length > 0 && (
          <IconBtn title="清空下载历史" data-testid="downloads-clear" onClick={() => setConfirmClear(true)}>
            <Trash2 size={14} />
          </IconBtn>
        )}
      </div>

      {/* 列表 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {loading ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>加载中…</div>
        ) : items.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            暂无下载记录
          </div>
        ) : items.map((entry) => {
          const Icon = fileIcon(entry.name, entry.isDir);
          return (
            <div key={entry.id}
              data-testid={`download-item-${entry.name}`}
              title={`远程路径：${entry.remotePath}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 10px', fontSize: 12,
              }}>
              <span style={{ width: 18, flexShrink: 0, display: 'inline-flex', justifyContent: 'center', color: 'var(--text-muted)' }}>
                <Icon size={13} />
              </span>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
                }}>
                  {entry.name}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {fmtSize(entry.size)} · {fmtTime(entry.downloadedAt)}
                  {entry.connectionName ? ` · ${entry.connectionName}` : ''}
                </span>
              </div>
              <button onClick={() => reveal(entry)} data-testid={`download-reveal-${entry.name}`}
                title="在文件管理器中显示"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
                  fontSize: 11, padding: '2px 8px', border: '1px solid var(--border)',
                  borderRadius: 4, background: 'transparent', color: 'var(--text-secondary)',
                  cursor: 'pointer',
                }}>
                <FolderOpen size={12} /> 定位
              </button>
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="清空下载历史"
        message="确定要清空全部下载记录吗？（不会删除已下载的文件）"
        danger
        confirmLabel="清空"
        onConfirm={clear}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
