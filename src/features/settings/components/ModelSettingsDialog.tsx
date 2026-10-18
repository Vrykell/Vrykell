/**
 * ModelSettingsDialog — the centred editor for one model entry.
 *
 * The fields save the way the rest of the settings do (on blur, with the field's own status), so
 * the dialog is only a surface: closing it keeps whatever was already committed.
 */
import { t } from '@i18n';
import Select from '@ui/Select';
import { detectCapabilities } from '@features/agent/model/capabilities';
import type { ModelProfile } from '@features/agent';
import { modelAvatar, modelHue, modelMark, providerLabel } from '@features/agent/components/modelIcon';
import { baseUrlForProvider, type ProviderKind } from '@features/agent/services/provider';
import { updateModel } from '@features/settings/model/modelWrites';
import { ModelTextInput } from './ui';
import ModelThinkingSettings from './ModelThinkingSettings';
import SettingsDialog from './SettingsDialog';

/** API families a model row can use, in the order the select offers them. */
const PROVIDER_KINDS: ProviderKind[] = ['openai-compatible', 'anthropic', 'gemini'];

export default function ModelSettingsDialog({ open, model, onClose }: {
  open: boolean;
  model: ModelProfile;
  onClose: () => void;
}) {
  const avatar = modelAvatar(model.provider, model.model, model.baseUrl);
  const Mark = avatar?.mark ?? modelMark(model.provider, model.model, model.baseUrl);
  const name = model.name || model.model || t('Unnamed model');

  return (
    <SettingsDialog
      open={open}
      testId="model-settings-dialog"
      title={name}
      width={480}
      onClose={onClose}
      icon={
        <span style={{
          width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: avatar?.background ?? 'var(--block)',
          color: avatar?.color ?? modelHue(model.provider, model.model, model.baseUrl),
        }}>
          <Mark size={14} aria-hidden="true" />
        </span>
      }
      footer={
        <button
          type="button"
          className="primary-button"
          onClick={onClose}
          data-testid="model-settings-done"
          style={{
            padding: '5px 16px', fontSize: 'calc(12px * var(--ui-font-scale))', border: 'none',
            borderRadius: 'var(--radius-inner)', background: 'var(--primary-button-bg)',
            color: 'var(--primary-button-text)', cursor: 'pointer',
          }}
        >
          {t('Done')}
        </button>
      }
    >
      <ModelTextInput value={model.name} placeholder={t('Model name')}
        onCommit={value => updateModel(model.id, { name: value })} />
      <Select
        aria-label={t('{{name}} provider', { name })}
        options={PROVIDER_KINDS.map(kind => ({ value: kind, label: providerLabel(kind) }))}
        value={model.provider}
        onChange={value => updateModel(model.id, { provider: value, baseUrl: baseUrlForProvider(model.baseUrl, value) })}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <ModelTextInput value={model.baseUrl} placeholder={t('Endpoint (base URL)')}
          onCommit={value => updateModel(model.id, { baseUrl: value })} style={{ flex: 1 }} />
        <ModelTextInput value={model.model} placeholder={t('Model ID')}
          onCommit={value => updateModel(model.id, { model: value, capabilities: detectCapabilities(model.provider, value) })}
          style={{ flex: 1 }} />
      </div>
      <ModelThinkingSettings modelId={model.id} name={name} />
    </SettingsDialog>
  );
}
