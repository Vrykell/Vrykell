/**
 * ProviderEndpointCard — the endpoint every model of this provider shares.
 *
 * The preview line spells out the URL a request really reaches: the provider SDK appends its own
 * path to the configured base, so the page shows that derived endpoint instead of making the user
 * guess it.
 */
import { t } from '@i18n';
import CopyButton from '@ui/CopyButton';
import { providerLabel } from '@features/agent/components/modelIcon';
import { effectiveEndpoint } from '@features/agent/services/provider';
import type { ModelProfile } from '@features/agent';
import { providerId, type ProviderRow } from '@features/settings/model/providerList';
import { commitModels } from '@features/settings/model/modelWrites';
import { SettingsGroup, Field } from './ui';
import AutoSaveInput from './AutoSaveInput';

export default function ProviderEndpointCard({ row }: { row: ProviderRow<ModelProfile> }) {
  const name = row.name || providerLabel(row.kind);

  // The address belongs to the provider: every model row of this endpoint moves with it.
  const commit = (value: string) => commitModels(current => current.map(model =>
    providerId(model.provider, model.baseUrl) === row.id ? { ...model, baseUrl: value } : model,
  ));

  return (
    <SettingsGroup title={t('Connection')}>
      <Field
        layout="stacked"
        title={t('{{name}} API address', { name })}
        description={t('Requests go to this endpoint; every model of the provider shares it.')}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AutoSaveInput
            value={row.baseUrl}
            aria-label={t('{{name}} API address', { name })}
            placeholder="https://…"
            onCommit={commit}
            testId="provider-endpoint-input"
            style={{ flex: 1, fontFamily: 'var(--font-mono)' }}
          />
          <CopyButton testId="provider-endpoint-copy" text={row.baseUrl}
            label={t('Copy API address')} iconSize={14} style={{ width: 28, height: 28 }} />
        </div>
        <div
          data-testid="provider-endpoint-preview"
          style={{ marginTop: 6, color: 'var(--text-muted)', fontSize: 'var(--fs-caption)', overflowWrap: 'anywhere' }}
        >
          {t('{{name}} preview: {{url}}', {
            name,
            url: effectiveEndpoint(row.kind, row.baseUrl, row.models[0]?.model ?? ''),
          })}
        </div>
      </Field>
    </SettingsGroup>
  );
}
