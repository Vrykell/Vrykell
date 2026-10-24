/**
 * KeyDialog — the centred editor for one provider's API key.
 *
 * The key never sits on the page: the dialog writes it straight through the provider store and
 * the caller keeps showing the masked form the backend returns. The eye toggles the field's
 * visibility for this edit only; a rejected write keeps the dialog open and reports why.
 */
import { useEffect, useState } from 'react';
import { t } from '@i18n';
import { OutlineButton } from '@ui/actions/OutlineButton';
import { TextInput } from '@ui/fields/TextInput';
import { IconButton } from '@ui/actions/IconButton';
import { Eye, EyeOff } from '@ui/icons';
import { setProviderKey, type ModelProfile } from '@features/agent';
import { modelHue, modelMark, providerLabel } from '@features/agent/components/modelIcon';
import type { ProviderRow } from '@features/settings/model/providerList';
import { inputStyle } from './formStyles';
import SettingsDialog from './SettingsDialog';

type Toast = (msg: string, type: 'info' | 'success' | 'error') => void;

export default function KeyDialog({ open, row, hasKey, toast, onClose }: {
  open: boolean;
  row: ProviderRow<ModelProfile>;
  hasKey: boolean;
  toast: Toast;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValue('');
      setVisible(false);
    }
  }, [open]);

  const Mark = modelMark(row.kind, '', row.baseUrl);
  const name = row.name || providerLabel(row.kind);

  const save = async () => {
    if (!value.trim()) {
      // A disabled primary gives no feedback; say what is missing.
      toast(t('Enter an API key first.'), 'info');
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      await setProviderKey(row.id, value);
      onClose();
    } catch (error) {
      toast(String((error as Error)?.message ?? error), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsDialog
      open={open}
      testId="key-dialog"
      title={t('{{name}} · {{action}}', { name, action: t(hasKey ? 'Edit API key' : 'Add API key') })}
      width={460}
      onClose={onClose}
      icon={
        <span style={{
          width: 24, height: 24, flexShrink: 0, display: 'inline-flex', alignItems: 'center',
          justifyContent: 'center', color: modelHue(row.kind, '', row.baseUrl),
        }}>
          <Mark size={20} aria-hidden="true" />
        </span>
      }
      footer={<>
        <OutlineButton onClick={onClose} data-testid="key-dialog-cancel">{t('Cancel')}</OutlineButton>
        <button
          type="button"
          className="primary-button"
          onClick={() => void save()}
          data-testid="key-dialog-save"
          style={{
            padding: '5px 16px', fontSize: 'calc(12px * var(--ui-font-scale))', border: 'none',
            borderRadius: 'var(--radius-inner)', background: 'var(--primary-button-bg)',
            color: 'var(--primary-button-text)', cursor: 'pointer',
            opacity: value.trim() ? 1 : 0.6,
          }}
        >
          {t('Save and close')}
        </button>
      </>}
    >
      <div style={{ ...inputStyle, display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px 0 10px', minHeight: 34 }}>
        <TextInput
          autoFocus
          type={visible ? 'text' : 'password'}
          value={value}
          aria-label={t('Provider API Key')}
          placeholder={t('Enter API key')}
          data-testid="key-dialog-input"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void save(); }}
          style={{
            flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
            color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
            fontSize: 'calc(12px * var(--ui-font-scale))',
          }}
        />
        <IconButton
          compact
          data-testid="key-dialog-reveal"
          aria-label={t(visible ? 'Hide API key' : 'Reveal API key')}
          data-tip={t(visible ? 'Hide API key' : 'Reveal API key')}
          onClick={() => setVisible(current => !current)}
        >
          {visible ? <EyeOff size={14} /> : <Eye size={14} />}
        </IconButton>
      </div>
      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-micro)' }}>
        {t('The key is stored only on this device and never leaves the backend.')}
      </span>
    </SettingsDialog>
  );
}
