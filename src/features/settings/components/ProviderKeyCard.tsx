/**
 * ProviderKeyCard — one provider's API key row: the masked value with actions that appear on
 * hover, plus a connection check that asks the provider for its model list.
 *
 * Keys belong to the provider (endpoint), not to the API family: each one is stored and read
 * under its own id, so switching providers switches keys. The plaintext never arrives for the
 * display — the masked form and the reveal both come from the backend, and the reveal is fetched
 * only while the user asks to see it. Adding or replacing a key opens the centred editor, so the
 * page itself never shows an empty secret field.
 */
import { useEffect, useState } from 'react';
import { t } from '@i18n';
import { IconButton } from '@ui/IconButton';
import { OutlineButton } from '@ui/OutlineButton';
import { Copy, Eye, EyeOff, Key, Pencil, Trash2, iconSizes } from '@ui/icons';
import { writeClipboardText } from '@platform/clipboard';
import {
  clearProviderKey, providerFetchModels, providerKeyHint, providerKeyReveal,
  useAiConfigStore, type ModelProfile,
} from '@features/agent';
import { providerHasKey, type ProviderRow } from '@features/settings/model/providerList';
import { SettingsGroup, Field } from './ui';
import KeyDialog from './KeyDialog';

type Toast = (msg: string, type: 'info' | 'success' | 'error') => void;

export default function ProviderKeyCard({ row, toast, keyEditRequest = 0 }: {
  row: ProviderRow<ModelProfile>;
  toast: Toast;
  /** Bumped by the page when the provider menu asks to edit this key. */
  keyEditRequest?: number;
}) {
  const aiCfg = useAiConfigStore();
  const keySet = providerHasKey(row.id, aiCfg);
  const [hint, setHint] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  /** Bumped after a replacement so the masked form is fetched again. */
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    setRevealed(null);
    let cancelled = false;
    if (!keySet) {
      setHint(null);
      return;
    }
    void providerKeyHint(row.id)
      .then((value) => { if (!cancelled) setHint(value); })
      .catch(() => { if (!cancelled) setHint(null); });
    return () => { cancelled = true; };
  }, [row.id, keySet, revision]);

  // The provider menu's "edit key" opens the editor for the selected provider.
  useEffect(() => {
    if (keyEditRequest > 0) setDialogOpen(true);
  }, [keyEditRequest]);

  const toggleReveal = async () => {
    if (revealed !== null) {
      setRevealed(null);
      return;
    }
    try {
      setRevealed(await providerKeyReveal(row.id));
    } catch (error) {
      toast(String((error as Error)?.message ?? error), 'error');
    }
  };

  const copy = async () => {
    try {
      const key = revealed ?? await providerKeyReveal(row.id);
      await writeClipboardText(key ?? '');
      toast(t('API key copied'), 'success');
    } catch (error) {
      toast(String((error as Error)?.message ?? error), 'error');
    }
  };

  const clear = async () => {
    await clearProviderKey(row.id);
    toast(t('API key cleared'), 'success');
  };

  /** The check doubles as the sync's probe: it asks the provider for its model list. */
  const check = async () => {
    setChecking(true);
    try {
      const models = await providerFetchModels(row.id, row.kind, row.baseUrl);
      toast(t('Connection works: {{count}} models', { count: models.length }), 'success');
    } catch (error) {
      toast(String((error as Error)?.message ?? error), 'error');
    } finally {
      setChecking(false);
    }
  };

  return (
    <SettingsGroup title={t('Provider credentials')}>
      <Field
        layout="stacked"
        title={t('Provider API Key')}
        description={t('Models from the current provider share one key, stored only on this device.')}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {keySet ? (
            <div data-testid="provider-key-row" className="settings-key-row">
              <span data-testid="provider-key-value" className="settings-key-value">
                {revealed ?? hint ?? '••••••••'}
              </span>
              <span className="settings-key-actions">
                <IconButton data-testid="provider-key-reveal"
                  aria-label={t(revealed !== null ? 'Hide API key' : 'Reveal API key')}
                  data-tip={t(revealed !== null ? 'Hide API key' : 'Reveal API key')}
                  onClick={() => void toggleReveal()}>
                  {revealed !== null ? <EyeOff size={iconSizes.control} /> : <Eye size={iconSizes.control} />}
                </IconButton>
                <IconButton data-testid="provider-key-copy"
                  aria-label={t('Copy API key')} data-tip={t('Copy API key')} onClick={() => void copy()}>
                  <Copy size={iconSizes.control} />
                </IconButton>
                <IconButton data-testid="provider-key-replace"
                  aria-label={t('Edit API key')} data-tip={t('Edit API key')} onClick={() => setDialogOpen(true)}>
                  <Pencil size={iconSizes.control} />
                </IconButton>
                <IconButton tone="danger" data-testid="provider-key-clear"
                  aria-label={t('Clear API key')} data-tip={t('Clear API key')} onClick={() => void clear()}>
                  <Trash2 size={iconSizes.control} />
                </IconButton>
              </span>
            </div>
          ) : (
            <button type="button" data-testid="provider-key-add" className="settings-key-row settings-key-empty"
              onClick={() => setDialogOpen(true)}>
              <Key size={14} aria-hidden="true" />
              <span className="settings-key-add-label">{t('Add API key')}</span>
            </button>
          )}
          <OutlineButton data-testid="provider-check" disabled={checking || !keySet} onClick={() => void check()}>
            {checking ? t('Checking…') : t('Check')}
          </OutlineButton>
        </div>
      </Field>
      <KeyDialog
        open={dialogOpen}
        row={row}
        hasKey={keySet}
        toast={toast}
        onClose={() => {
          setDialogOpen(false);
          setRevision(current => current + 1);
        }}
      />
    </SettingsGroup>
  );
}
