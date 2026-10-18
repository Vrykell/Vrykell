import { useEffect, useState } from 'react';
import ErrorBox from '@ui/ErrorBox';
import ToolDialog from '@ui/ToolDialog';
import { fmtSize } from '@ui/UiBtn';
import { t } from '@i18n';
import type { FileStat, FsEntry } from '@platform/api/types';

interface Props {
  entry: FsEntry;
  /** Parent directory shown in the location row (empty string hides the row). */
  location: string;
  /** Metadata reader; the owning FileOps decides local vs remote. */
  stat: (path: string) => Promise<FileStat>;
  onClose: () => void;
}

type StatState =
  | { status: 'loading' }
  | { status: 'ready'; value: FileStat }
  | { status: 'error'; message: string };

/** Extension without the leading dot; hidden files (.bashrc) count as extension-less. */
function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1) : '';
}

/**
 * FilePropertiesDialog — properties of a single entry (name / type / location /
 * size / times), shared by the local and SSH panels. The caller passes the
 * metadata reader, so this view never branches on the target.
 */
export default function FilePropertiesDialog({ entry, location, stat, onClose }: Props) {
  const [state, setState] = useState<StatState>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    stat(entry.path).then(
      (value) => { if (alive) setState({ status: 'ready', value }); },
      (cause: unknown) => { if (alive) setState({ status: 'error', message: String((cause as Error)?.message ?? cause) }); },
    );
    return () => { alive = false; };
  }, [entry.path, stat]);

  const rows: Array<{ key: string; label: string; value: string }> = [];
  if (state.status === 'ready') {
    const info = state.value;
    const ext = extOf(info.name);
    rows.push({ key: 'name', label: t('Name'), value: info.name });
    rows.push({
      key: 'type',
      label: t('Type'),
      value: info.is_dir ? t('Folder') : ext ? t('{{ext}} file', { ext: ext.toUpperCase() }) : t('File'),
    });
    if (location) rows.push({ key: 'location', label: t('Location'), value: location });
    if (!info.is_dir) rows.push({ key: 'size', label: t('Size'), value: fmtSize(info.size) });
    if (info.modified_ms !== null) rows.push({ key: 'modified', label: t('Modified time'), value: new Date(info.modified_ms).toLocaleString() });
    if (info.created_ms !== null) rows.push({ key: 'created', label: t('Created time'), value: new Date(info.created_ms).toLocaleString() });
  }

  return (
    <ToolDialog label={t('Properties')} onClose={onClose} width={380} closePlacement="footer">
      {state.status === 'loading' && (
        <div role="status" style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-muted)' }}>
          {t('Reading properties…')}
        </div>
      )}

      {state.status === 'error' && (
        <ErrorBox tone="error" title={t('Could not read properties')} style={{ overflowWrap: 'anywhere' }}>
          {state.message}
        </ErrorBox>
      )}

      {state.status === 'ready' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, userSelect: 'text' }}>
          {rows.map((row) => (
            <div key={row.key} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 'calc(12px * var(--ui-font-scale))', lineHeight: 1.5 }}>
              <span style={{ width: 64, flexShrink: 0, color: 'var(--text-muted)' }}>{row.label}</span>
              <span
                data-testid={`file-property-${row.key}`}
                style={{ flex: 1, minWidth: 0, color: 'var(--text-primary)', wordBreak: 'break-all' }}
              >{row.value}</span>
            </div>
          ))}
        </div>
      )}
    </ToolDialog>
  );
}
