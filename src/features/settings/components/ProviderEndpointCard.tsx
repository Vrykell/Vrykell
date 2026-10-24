/**
 * ProviderEndpointCard — the endpoint every model of this provider shares.
 *
 * The preview line spells out the URL a request really reaches: the provider SDK appends its own
 * path to the configured base, so the page shows that derived endpoint instead of making the user
 * guess it.
 */
import { t } from '@i18n';
import CopyButton from '@ui/actions/CopyButton';
import { providerLabel } from '@features/agent/components/modelIcon';
import { effectiveEndpoint } from '@features/agent/services/provider';
import type { ModelProfile } from '@features/agent';
import { providerId, type ProviderRow } from '@features/settings/model/providerList';
import { commitModels } from '@features/settings/model/modelWrites';
import { SettingsGroup, Field } from './ui';
import AutoSaveInput from './AutoSaveInput';
import { useEffect, useRef, useState } from 'react';
import ConfirmDialog from '@ui/feedback/ConfirmDialog';
import { setProviderKey, selectProvider, useAiConfigStore } from '@features/agent';

export default function ProviderEndpointCard({ row }: { row: ProviderRow<ModelProfile> }) {
  const name = row.name || providerLabel(row.kind);
  const [confirmation, setConfirmation] = useState<{ resolve: (allowed: boolean) => void } | null>(null);
  const [revision, setRevision] = useState(0);
  const pending = useRef<((allowed: boolean) => void) | null>(null);
  useEffect(() => () => { pending.current?.(false); pending.current = null; }, [row.id]);

  // The address belongs to the provider: every model row of this endpoint moves with it.
  const commit = async (value: string) => {
    let destination: URL;
    try { destination = new URL(value); } catch { throw new Error(t('Enter a valid HTTP or HTTPS API address.')); }
    if (!['http:', 'https:'].includes(destination.protocol) || destination.username || destination.password) throw new Error(t('Enter a valid HTTP or HTTPS API address.'));
    const nextId = providerId(row.kind, value);
    if (nextId === row.id) return;
    const hasKey = useAiConfigStore.getState().providerKeys.includes(row.id);
    let sameOrigin = false;
    try { sameOrigin = new URL(row.baseUrl).origin === destination.origin; } catch {}
    if (hasKey && !sameOrigin) {
      const allowed = await new Promise<boolean>(resolve => { pending.current = resolve; setConfirmation({ resolve }); });
      pending.current = null;
      setConfirmation(null);
      if (!allowed) { setRevision(previous => previous + 1); return; }
    }
    if (hasKey) await setProviderKey(nextId, '', row.id);
    await commitModels(current => current.map(model => providerId(model.provider, model.baseUrl) === row.id ? { ...model, baseUrl: value } : model));
    selectProvider(nextId);
  };

  return (
    <SettingsGroup title={t('Connection')}>
      <Field
        layout="stacked"
        title={t('{{name}} API address', { name })}
        description={t('Requests go to this endpoint; every model of the provider shares it.')}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AutoSaveInput
            key={revision}
            value={row.baseUrl}
            aria-label={t('{{name}} API address', { name })}
            placeholder="https://…"
            onCommit={commit}
            testId="provider-endpoint-input"
            style={{ flex: 1, fontFamily: 'var(--font-mono)' }}
          />
          <CopyButton testId="provider-endpoint-copy" text={row.baseUrl}
            label={t('Copy API address')} iconSize={16} style={{ width: 32, height: 32 }} />
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
      <ConfirmDialog open={!!confirmation} title={t('Use the existing API key?')} message={t('The API address points to a different origin. Reuse this provider’s existing key for the new address?')} confirmLabel={t('Use existing key')} cancelLabel={t('Cancel')} onConfirm={() => confirmation?.resolve(true)} onCancel={() => confirmation?.resolve(false)} />
    </SettingsGroup>
  );
}
