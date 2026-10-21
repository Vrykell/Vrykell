/**
 * HarnessDialog — the centred editor for one ACP server entry, and the empty form behind "add".
 *
 * Name and command line are the two things an entry cannot work without; the rest stays optional.
 * The dialog writes back a whole entry, so the page keeps its single list state.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { t } from '@i18n';
import { OutlineButton } from '@ui/OutlineButton';
import { TextArea, TextInput } from '@ui/TextInput';
import ErrorBox from '@ui/ErrorBox';
import type { HarnessEntry } from '@config/harnessPresets';
import { inputStyle } from './formStyles';
import SettingsDialog from './SettingsDialog';

const fieldStyle: CSSProperties = { ...inputStyle, minWidth: 0 };
const labelStyle: CSSProperties = { color: 'var(--text-secondary)', fontSize: 'var(--fs-caption)' };

export default function HarnessDialog({ open, entry, onClose, onSave }: {
  open: boolean;
  /** The entry being edited; null opens an empty form. */
  entry: HarnessEntry | null;
  onClose: () => void;
  onSave: (entry: HarnessEntry) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(entry?.name ?? '');
    setCommand(entry?.command ?? '');
    setArgs(entry?.args.join('\n') ?? '');
    setEnabled(entry?.enabled ?? true);
    setError(false);
  }, [open, entry]);

  const canSave = !saving && name.trim().length > 0 && command.trim().length > 0;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(false);
    try {
      const saved = await onSave({
        name: name.trim(), command: command.trim(),
        args: args ? args.split(/\r?\n/) : [],
        env: entry?.env ?? {}, cwd: entry?.cwd ?? '', enabled,
      });
      if (saved) onClose();
      else setError(true);
    } catch { setError(true); }
    finally { setSaving(false); }
  };

  return (
    <SettingsDialog
      open={open}
      testId="harness-dialog"
      title={entry ? t('Edit server') : t('Add server')}
      width={480}
      initialFocus="[data-testid=harness-dialog-name]"
      onClose={() => { if (!saving) onClose(); }}
      footer={<>
        <OutlineButton disabled={saving} onClick={onClose} data-testid="harness-dialog-cancel">{t('Cancel')}</OutlineButton>
        <button
          type="button"
          className="primary-button"
          disabled={!canSave}
          onClick={() => void save()}
          data-testid="harness-dialog-save"
          style={{
            padding: '5px 16px', fontSize: 'calc(12px * var(--ui-font-scale))', border: 'none',
            borderRadius: 'var(--radius-inner)', background: 'var(--primary-button-bg)',
            color: 'var(--primary-button-text)', cursor: 'pointer', opacity: canSave ? 1 : 0.6,
          }}
        >
          {entry ? t('Save') : t('Add')}
        </button>
      </>}
    >
      {error && <ErrorBox compact>{t('Could not save servers. Your changes are kept. Try again.')}</ErrorBox>}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', alignItems: 'center', gap: '10px 12px' }}>
        <label htmlFor="harness-dialog-name" style={labelStyle}>
          {t('Name')} <span style={{ color: 'var(--error)' }}>*</span>
        </label>
        <TextInput
          id="harness-dialog-name"
          autoFocus
          disabled={saving}
          value={name}
          data-testid="harness-dialog-name"
          onChange={(event) => setName(event.target.value)}
          style={fieldStyle}
        />
        <label htmlFor="harness-dialog-command" style={labelStyle}>
          {t('Command')} <span style={{ color: 'var(--error)' }}>*</span>
        </label>
        <TextInput
          id="harness-dialog-command"
          disabled={saving}
          value={command}
          data-testid="harness-dialog-command"
          placeholder={t('For example npx')}
          onChange={(event) => setCommand(event.target.value)}
          style={fieldStyle}
        />
        <label htmlFor="harness-dialog-args" style={labelStyle}>{t('Arguments')}</label>
        <TextArea
          id="harness-dialog-args"
          disabled={saving}
          value={args}
          data-testid="harness-dialog-args"
          rows={3}
          placeholder={t('One argument per line. Spaces are kept.')}
          onChange={(event) => setArgs(event.target.value)}
          style={fieldStyle}
        />
      </div>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)', fontSize: 'var(--fs-caption)' }}>
        <input type="checkbox" disabled={saving} checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        {t('Enabled')}
      </label>
      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-micro)' }}>
        {t('Adding a server is the authorization: it runs with your account, like a command typed into the terminal.')}
      </span>
    </SettingsDialog>
  );
}
