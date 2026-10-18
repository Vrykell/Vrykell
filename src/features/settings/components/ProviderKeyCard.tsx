/**
 * ProviderKeyCard — one provider's API key row: the masked value with reveal, copy, replace and
 * clear, plus a connection check that asks the provider for its model list.
 *
 * The plaintext never arrives for the display: the masked form and the reveal both come from the
 * backend, and the reveal is fetched only while the user asks to see it.
 */
import { useEffect, useRef, useState } from 'react';
import { t } from '@i18n';
import { IconButton } from '@ui/IconButton';
import { OutlineButton } from '@ui/OutlineButton';
import { Copy, Eye, EyeOff, Pencil, Trash2 } from '@ui/icons';
import { writeClipboardText } from '@platform/clipboard';
import {
  clearProviderKey, providerFetchModels, providerKeyHint, providerKeyReveal, setProviderKey,
  useAiConfigStore, type ModelProfile,
} from '@features/agent';
import { providerHasKey, type ProviderRow } from '@features/settings/model/providerList';
import { SettingsGroup, Field, inputStyle } from './ui';
import AutoSaveInput from './AutoSaveInput';

type Toast = (msg: string, type: 'info' | 'success' | 'error') => void;

export default function ProviderKeyCard({ row, toast, keyEditRequest = 0 }: {
  row: ProviderRow<ModelProfile>;
  toast: Toast;
  /** Bumped by the page when the provider menu asks to edit this key. */
  keyEditRequest?: number;
}) {
  const aiCfg = useAiConfigStore();
  const keySet = providerHasKey(row.kind, aiCfg);
  const [hint, setHint] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [checking, setChecking] = useState(false);
  /** Bumped after a replacement so the masked form is fetched again. */
  const [revision, setRevision] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRevealed(null);
    setReplacing(false);
    let cancelled = false;
    if (!keySet) {
      setHint(null);
      return;
    }
    void providerKeyHint(row.kind)
      .then((value) => { if (!cancelled) setHint(value); })
      .catch(() => { if (!cancelled) setHint(null); });
    return () => { cancelled = true; };
  }, [row.kind, keySet, revision]);

  // The provider menu's "edit key" opens the replace input; either way it takes focus.
  useEffect(() => {
    if (keyEditRequest > 0) setReplacing(true);
  }, [keyEditRequest]);
  useEffect(() => {
    if (replacing) containerRef.current?.querySelector('input')?.focus();
  }, [replacing]);

  const toggleReveal = async () => {
    if (revealed !== null) {
      setRevealed(null);
      return;
    }
    try {
      setRevealed(await providerKeyReveal(row.kind));
    } catch (error) {
      toast(String((error as Error)?.message ?? error), 'error');
    }
  };

  const copy = async () => {
    try {
      const key = revealed ?? await providerKeyReveal(row.kind);
      await writeClipboardText(key ?? '');
      toast(t('API key copied'), 'success');
    } catch (error) {
      toast(String((error as Error)?.message ?? error), 'error');
    }
  };

  const clear = async () => {
    await clearProviderKey(row.kind);
    toast(t('API key cleared'), 'success');
  };

  /** The check doubles as the sync's probe: it asks the provider for its model list. */
  const check = async () => {
    setChecking(true);
    try {
      const models = await providerFetchModels(row.kind, row.baseUrl);
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
        <div ref={containerRef} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {keySet && !replacing ? (
            <div
              data-testid="provider-key-row"
              style={{ ...inputStyle, display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 }}
            >
              <span
                data-testid="provider-key-value"
                style={{
                  flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  fontFamily: 'var(--font-mono)', color: 'var(--text-primary)',
                }}
              >
                {revealed ?? hint ?? '••••••••'}
              </span>
              <IconButton compact data-testid="provider-key-reveal"
                aria-label={t(revealed !== null ? 'Hide API key' : 'Reveal API key')}
                data-tip={t(revealed !== null ? 'Hide API key' : 'Reveal API key')}
                onClick={() => void toggleReveal()}>
                {revealed !== null ? <EyeOff size={14} /> : <Eye size={14} />}
              </IconButton>
              <IconButton compact data-testid="provider-key-copy"
                aria-label={t('Copy API key')} data-tip={t('Copy API key')} onClick={() => void copy()}>
                <Copy size={14} />
              </IconButton>
              <IconButton compact data-testid="provider-key-replace"
                aria-label={t('Replace API key')} data-tip={t('Replace API key')} onClick={() => setReplacing(true)}>
                <Pencil size={14} />
              </IconButton>
              <IconButton compact tone="danger" data-testid="provider-key-clear"
                aria-label={t('Clear API key')} data-tip={t('Clear API key')} onClick={() => void clear()}>
                <Trash2 size={14} />
              </IconButton>
            </div>
          ) : (
            <AutoSaveInput
              key={`${row.kind}-${keySet}`}
              type="password"
              value=""
              aria-label={t('Provider API Key')}
              placeholder={keySet ? t('Type to replace; leave empty to keep') : t('Enter API key')}
              onCommit={async (key) => {
                await setProviderKey(row.kind, key);
                setReplacing(false);
                setRevision(current => current + 1);
              }}
              clearAfterSave
              validate={key => key.trim() ? undefined : t('Type to replace; leave empty to keep')}
              style={{ flex: 1 }}
            />
          )}
          <OutlineButton data-testid="provider-check" disabled={checking || !keySet} onClick={() => void check()}>
            {checking ? t('Checking…') : t('Check')}
          </OutlineButton>
        </div>
      </Field>
    </SettingsGroup>
  );
}
