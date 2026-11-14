/**
 * ModelSettingsDialog — the centred editor for one model entry.
 *
 * The fields save the way the rest of the settings do (on blur, with the field's own status), so
 * the dialog is only a surface: closing it keeps whatever was already committed. A row that was
 * just added opens here with the model identifier focused, because that is the one field it
 * cannot work without.
 */
import type { ReactNode } from 'react';
import { t } from '@i18n';
import Select from '@ui/fields/Select';
import { OutlineButton } from '@ui/actions/OutlineButton';
import { detectCapabilities, type ModelCapability } from '@features/agent/model/capabilities';
import { ModelCapabilityToggle } from '@features/agent/components/ModelCapabilityToggle';
import type { ModelProfile } from '@features/agent';
import { modelHue, modelMark, providerLabel } from '@features/agent/components/modelIcon';
import { baseUrlForProvider } from '@features/agent/services/provider';
import { PROVIDERS } from '@config/providers';
import { updateModel, updateModelCapability, resetModelCapabilities } from '@features/settings/model/modelWrites';
import { useSettingsSave } from './SettingsSaveProvider';
import AutoSaveInput from './AutoSaveInput';
import ModelThinkingSettings from './ModelThinkingSettings';
import SettingsDialog from './SettingsDialog';
import ModelContextSettings from './ModelContextSettings';

/** API families a model row can use, in the order the select offers them. */
const PROVIDER_KINDS = PROVIDERS.map((provider) => provider.kind);
const CAPABILITIES: ModelCapability[] = ['vision', 'reasoning', 'tools', 'search'];

function DialogField({ id, label, wide = false, children }: { id: string; label: string; wide?: boolean; children: ReactNode }) {
  return <div className={`model-dialog-field${wide ? ' model-dialog-field-wide' : ''}`}>
    <label className="model-dialog-label" htmlFor={id}>{label}</label>
    {children}
  </div>;
}

export default function ModelSettingsDialog({ open, model, focusModelId = false, onClose }: {
  open: boolean;
  model: ModelProfile;
  /** Focus the identifier field first (a freshly added row needs it). */
  focusModelId?: boolean;
  onClose: () => void;
}) {
  const Mark = modelMark(model.provider, model.model, model.baseUrl);
  const name = model.name || model.model || t('Unnamed model');
  const capabilities = model.capabilities ?? detectCapabilities(model.provider, model.model);
  const { save } = useSettingsSave();

  return (
    <SettingsDialog
      open={open}
      testId="model-settings-dialog"
      title={name}
      width={600}
      initialFocus={focusModelId ? '[data-testid="model-id-input"]' : undefined}
      onClose={onClose}
      icon={
        <span style={{
          width: 24, height: 24, flexShrink: 0, display: 'inline-flex', alignItems: 'center',
          justifyContent: 'center', color: modelHue(model.provider, model.model, model.baseUrl),
        }}>
          <Mark size={20} aria-hidden="true" />
        </span>
      }
      footer={
        <div className="model-dialog-footer">
          <OutlineButton data-testid="model-capabilities-reset" style={{ marginRight: 'auto' }}
            onClick={() => { void save(() => resetModelCapabilities(model.id)); }}>{t('Reset')}</OutlineButton>
          <OutlineButton className="primary-button" data-testid="model-settings-done" onClick={onClose}>
            {t('Done')}
          </OutlineButton>
        </div>
      }
    >
      <div className="model-dialog-form">
        <div className="model-dialog-grid">
          <DialogField id="model-name-input" label={t('Model name')}>
            <AutoSaveInput id="model-name-input" value={model.name} aria-label={t('Model name')} placeholder={t('Model name')}
              onCommit={value => updateModel(model.id, { name: value })} />
          </DialogField>
          <DialogField id="model-group-input" label={t('Group')}>
            <AutoSaveInput id="model-group-input" value={model.group ?? ''} aria-label={t('Group')} placeholder={t('Group')}
              onCommit={value => updateModel(model.id, { group: value.trim() || undefined })} />
          </DialogField>
          <DialogField id="model-provider-input" label={t('Provider')}>
            <Select
              id="model-provider-input"
              aria-label={t('{{name}} provider', { name })}
              options={PROVIDER_KINDS.map(kind => ({ value: kind, label: providerLabel(kind) }))}
              value={model.provider}
              onChange={value => updateModel(model.id, { provider: value, baseUrl: baseUrlForProvider(model.baseUrl, value) })}
              style={{ width: '100%' }}
            />
          </DialogField>
          <DialogField id="model-id-input" label={t('Model ID')}>
            <AutoSaveInput id="model-id-input" value={model.model} aria-label={t('Model ID')} placeholder={t('Model ID')}
              testId="model-id-input"
              onCommit={value => updateModel(model.id, { model: value, capabilities: detectCapabilities(model.provider, value) })} />
          </DialogField>
          <DialogField id="model-endpoint-input" label={t('Endpoint (base URL)')} wide>
            <AutoSaveInput id="model-endpoint-input" value={model.baseUrl} aria-label={t('Endpoint (base URL)')}
              placeholder={t('Endpoint (base URL)')} onCommit={value => updateModel(model.id, { baseUrl: value })} />
          </DialogField>
        </div>
        <div className="model-dialog-context">
          <ModelContextSettings key={model.id} modelId={model.id} />
        </div>
        <div className="model-dialog-capabilities">
          <span className="model-dialog-section-label">{t('Model capabilities')}</span>
          <div className="model-capability-settings" role="group" aria-label={t('Model capabilities')}>
            {CAPABILITIES.map(capability => <ModelCapabilityToggle key={capability} capability={capability}
              selected={capabilities[capability]}
              onChange={supported => { void save(() => updateModelCapability(model.id, capability, supported)); }} />)}
          </div>
          <ModelThinkingSettings modelId={model.id} name={name} />
        </div>
      </div>
    </SettingsDialog>
  );
}
