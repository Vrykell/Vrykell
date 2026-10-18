/**
 * AddModelDialog — the centred form behind the model list's "+".
 *
 * It asks for what a row cannot work without (the model identifier) and for what makes it
 * readable (a name, a group); everything else stays in the row's own editor. The group field
 * takes a new label or an existing one, so models of the same endpoint can be split up the way
 * the user thinks about them instead of only by the detected vendor.
 */
import { useEffect, useState } from 'react';
import { t } from '@i18n';
import { OutlineButton } from '@ui/OutlineButton';
import { TextInput } from '@ui/TextInput';
import { detectCapabilities } from '@features/agent/model/capabilities';
import type { ModelProfile } from '@features/agent';
import { newModelId } from '@features/settings/model/modelWrites';
import type { ProviderRow } from '@features/settings/model/providerList';
import { inputStyle } from './formStyles';
import SettingsDialog from './SettingsDialog';

const fieldStyle = { ...inputStyle, minWidth: 0 };

export default function AddModelDialog({ open, row, toast, onClose, onAdd }: {
  open: boolean;
  row: ProviderRow<ModelProfile>;
  toast: (msg: string, type: 'info' | 'success' | 'error') => void;
  onClose: () => void;
  onAdd: (model: ModelProfile) => void;
}) {
  const [modelId, setModelId] = useState('');
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');

  useEffect(() => {
    if (open) {
      setModelId('');
      setName('');
      setGroup('');
    }
  }, [open]);

  const canAdd = modelId.trim().length > 0;

  const add = () => {
    if (!canAdd) {
      // A disabled primary gives no feedback; say what is missing and put the caret there.
      toast(t('Fill in the model ID first.'), 'info');
      document.getElementById('add-model-id')?.focus();
      return;
    }
    const id = modelId.trim();
    onAdd({
      id: newModelId(),
      name: name.trim() || id,
      provider: row.kind,
      baseUrl: row.baseUrl,
      model: id,
      group: group.trim() || undefined,
      capabilities: detectCapabilities(row.kind, id),
    });
    onClose();
  };

  return (
    <SettingsDialog
      open={open}
      testId="add-model-dialog"
      title={t('Add model')}
      width={460}
      initialFocus="[data-testid=add-model-id]"
      onClose={onClose}
      footer={<>
        <OutlineButton onClick={onClose} data-testid="add-model-cancel">{t('Cancel')}</OutlineButton>
        <button
          type="button"
          className="primary-button"
          onClick={add}
          data-testid="add-model-confirm"
          style={{
            padding: '5px 16px', fontSize: 'calc(12px * var(--ui-font-scale))', border: 'none',
            borderRadius: 'var(--radius-inner)', background: 'var(--primary-button-bg)',
            color: 'var(--primary-button-text)', cursor: 'pointer',
            opacity: canAdd ? 1 : 0.6,
          }}
        >
          {t('Add model')}
        </button>
      </>}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', alignItems: 'center', gap: '10px 12px' }}>
        <label htmlFor="add-model-id" style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-caption)' }}>
          {t('Model ID')} <span style={{ color: 'var(--error)' }}>*</span>
        </label>
        <TextInput
          id="add-model-id"
          autoFocus
          value={modelId}
          data-testid="add-model-id"
          placeholder={t('For example deepseek-chat')}
          onChange={(event) => setModelId(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') add(); }}
          style={fieldStyle}
        />
        <label htmlFor="add-model-name" style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-caption)' }}>
          {t('Model name')}
        </label>
        <TextInput
          id="add-model-name"
          value={name}
          data-testid="add-model-name"
          placeholder={t('Defaults to the model ID')}
          onChange={(event) => setName(event.target.value)}
          style={fieldStyle}
        />
        <label htmlFor="add-model-group" style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-caption)' }}>
          {t('Group')}
        </label>
        <TextInput
          id="add-model-group"
          value={group}
          data-testid="add-model-group"
          placeholder={t('Empty groups by vendor')}
          onChange={(event) => setGroup(event.target.value)}
          style={fieldStyle}
        />
      </div>
      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-micro)' }}>
        {t('The identifier decides the request; the group only sorts this list.')}
      </span>
    </SettingsDialog>
  );
}
