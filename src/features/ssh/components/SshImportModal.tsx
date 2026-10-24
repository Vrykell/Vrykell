import { OutlineButton } from '@ui/actions/OutlineButton';
import { Checkbox } from '@ui/fields/Checkbox';
import { useDialogKeyboard } from '@ui/hooks/useDialogKeyboard';
import './SshConnection.css';
import { useEffect, useRef, useState } from 'react';
import { t } from '@i18n';
import { useSshStore } from '@features/ssh';
import {
  newSshId,
  sshConfigCandidates,
  validateSshConnection,
  type SshConfigCandidate,
  type SshConnection,
} from '@features/ssh/services/api';
import ErrorBox from '@ui/feedback/ErrorBox';
import { useToastStore } from '@ui/feedback/Toast';

interface Props {
  open: boolean;
  onClose: () => void;
  onImported?: (connection: SshConnection) => void;
}

/** Address identity used to tell an already saved connection from a new one. */
function address(entry: { host: string; port?: number; user?: string }): string {
  return `${entry.host}:${entry.port ?? 22}:${entry.user ?? ''}`;
}

/**
 * Turn a config candidate into a saved connection. Authentication is left for the user to
 * complete: the file only tells which key path to use, never a password.
 */
function toConnection(candidate: SshConfigCandidate): SshConnection {
  return {
    id: newSshId(),
    name: candidate.name,
    host: candidate.host,
    user: candidate.user ?? '',
    port: candidate.port,
    identityFile: candidate.identityFile,
    jumpHost: candidate.jumpHost,
    localForwards: candidate.localForwards?.length ? candidate.localForwards : undefined,
    remoteForwards: candidate.remoteForwards?.length ? candidate.remoteForwards : undefined,
    dynamicForwards: candidate.dynamicForwards?.length ? candidate.dynamicForwards : undefined,
    authMethod: candidate.identityFile ? 'key' : 'password',
  };
}

const hint: React.CSSProperties = { fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)' };
const ghostBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '6px 12px', minHeight: 34, flexShrink: 0,
  fontSize: 'calc(12px * var(--ui-font-scale))',
};

/**
 * SshImportModal — import host aliases declared in the user's SSH config file.
 *
 * Shows every candidate with its address, marks the ones a saved connection already covers and
 * saves the selected aliases as new connections.
 */
export default function SshImportModal({ open, onClose, onImported }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const save = useSshStore((s) => s.save);
  const [candidates, setCandidates] = useState<SshConfigCandidate[]>([]);
  const [taken, setTaken] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null); setFailures({}); setDone(new Set()); setProgress({ completed: 0, total: 0 });
    setCandidates([]);
    setSelected(new Set());
    setLoading(true);
    const known = new Set(useSshStore.getState().connections.map(address));
    sshConfigCandidates()
      .then((entries) => {
        if (cancelled) return;
        setTaken(known);
        setCandidates(entries);
        setSelected(new Set(entries.filter((entry) => !known.has(address(entry))).map((entry) => entry.name)));
      })
      .catch((reason) => {
        if (!cancelled) setError(String((reason as Error)?.message ?? reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, attempt]);

  const importable = candidates.filter((candidate) => !taken.has(address(candidate)) && !done.has(candidate.name));
  const allSelected = importable.length > 0 && importable.every((candidate) => selected.has(candidate.name));

  const toggle = (name: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(importable.map((candidate) => candidate.name)));
  };

  const doImport = async () => {
    if (busy.current) return;
    const picked = importable.filter(candidate => selected.has(candidate.name));
    if (!picked.length) return;
    busy.current = true; setImporting(true); setProgress({ completed: 0, total: picked.length });
    const errors: Record<string, string> = {};
    const succeeded = new Set(done);
    let imported = 0;
    for (const [index, candidate] of picked.entries()) {
      const connection = toConnection(candidate);
      const invalid = validateSshConnection(connection);
      try {
        if (invalid) throw new Error(invalid);
        await save(connection); succeeded.add(candidate.name); imported += 1; onImported?.(connection);
      } catch (reason) { errors[candidate.name] = String((reason as Error)?.message ?? reason); }
      setProgress({ completed: index + 1, total: picked.length });
    }
    setDone(succeeded); setFailures(errors); setSelected(new Set(Object.keys(errors)));
    busy.current = false; setImporting(false);
    if (!Object.keys(errors).length) {
      useToastStore.getState().addToast(t('ssh.import.done', { n: imported }), 'success'); onClose();
    }
  };
  useDialogKeyboard(dialog, open, { onClose, disabled: importing, onSubmit: () => { void doImport(); } });

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9996,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--overlay)',
      }}
      onClick={() => { if (!busy.current) onClose(); }}
    >
      <div
        ref={dialog}
        tabIndex={-1}
        className="workspace-floating workspace-floating-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('ssh.import.title')}
        style={{
          width: 480, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100dvh - 24px)', overflow: 'hidden',
          padding: 16, display: 'flex', flexDirection: 'column', gap: 12,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ fontSize: 'calc(13px * var(--ui-font-scale))', fontWeight: 'var(--fw-semibold)', color: 'var(--text-primary)' }}>
          {t('ssh.import.title')}
        </div>
        <div style={{ ...hint, fontSize: 'calc(12px * var(--ui-font-scale))' }}>{t('ssh.import.description')}</div>

        {error !== null ? (
          <ErrorBox
            tone="error"
            title={t('ssh.import.loadFailed')}
            details={error}
            actions={<button type="button" onClick={() => setAttempt(value => value + 1)}>{t('Retry')}</button>}
            style={{ overflowWrap: 'anywhere' }}
          />
        ) : (
          <div
            data-testid="ssh-import-list"
            className="scroll-region"
            style={{ overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 }}
          >
            {loading && <div style={{ ...hint, padding: 8 }}>{t('Loading hosts…')}</div>}
            {!loading && candidates.length === 0 && (
              <div style={{ ...hint, padding: 8 }}>{t('ssh.import.empty')}</div>
            )}
            {candidates.map((candidate) => {
              const duplicate = taken.has(address(candidate));
              const imported = done.has(candidate.name);
              return (
                <div key={candidate.name}><label className="ssh-import-row" style={{ opacity: duplicate || imported ? 0.6 : 1 }}>
                  <Checkbox
                    type="checkbox"
                    checked={imported || (!duplicate && selected.has(candidate.name))}
                    disabled={duplicate || imported || importing}
                    onChange={() => toggle(candidate.name)}
                    data-testid={`ssh-import-${candidate.name}`}
                    style={{ marginTop: 2 }}
                  />
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span>{candidate.name}</span>
                    <span style={{ ...hint, overflowWrap: 'anywhere' }}>
                      {`${candidate.user ? `${candidate.user}@` : ''}${candidate.host}:${candidate.port ?? 22}`}
                      {imported ? ` · ${t('Imported')}` : duplicate ? ` · ${t('ssh.import.exists')}` : ''}
                    </span>
                  </span>
                </label>{failures[candidate.name] && <ErrorBox compact tone="error" title={candidate.name}>{failures[candidate.name]}</ErrorBox>}</div>
              );
            })}
          </div>
        )}

        {Object.keys(failures).length > 0 && <ErrorBox compact tone="info">{t('Imported {{n}}. Failed {{failed}}. Retry the selected failed hosts.', { n: done.size, failed: Object.keys(failures).length })}</ErrorBox>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <OutlineButton
            type="button"
            style={ghostBtn}
            data-testid="ssh-import-select-all"
            onClick={toggleAll}
            disabled={importing || importable.length === 0}
          >
            {t('ssh.import.selectAll')}
          </OutlineButton>
          <div style={{ flex: 1 }} />
          <OutlineButton type="button" style={ghostBtn} onClick={onClose} disabled={importing}>{t('Dismiss')}</OutlineButton>
          <button
            type="button"
            data-testid="ssh-import-confirm"
            className="primary-button"
            onClick={() => void doImport()}
            disabled={importing || selected.size === 0}
            style={{
              minHeight: 34, padding: '6px 18px', fontSize: 'calc(13px * var(--ui-font-scale))', border: 'none',
              borderRadius: 'var(--radius-inner)', background: 'var(--primary-button-bg)',
              color: 'var(--primary-button-text)', cursor: 'pointer',
            }}
          >
            {importing ? t('Importing {{n}}/{{total}}…', { n: progress.completed, total: progress.total }) : Object.keys(failures).length ? t('Retry failed imports') : t('ssh.import.action')}
          </button>
        </div>
      </div>
    </div>
  );
}
