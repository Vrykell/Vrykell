import { OutlineButton } from '@ui/OutlineButton';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@i18n';
import { getContextMenuStatus, manageContextMenu, type ContextMenuAction, type ContextMenuStatus } from '@platform/contextMenu';
import ErrorBox from '@ui/ErrorBox';
import { Field, SettingsGroup } from '../components/ui';

/** Manage the per-user shell registration and its explicit certificate trust step. */
export function ContextMenuPage() {
  const { t } = useT();
  const [status, setStatus] = useState<ContextMenuStatus>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string>();
  const revision = useRef(0);
  const refresh = async () => {
    const request = ++revision.current;
    setBusy(true); setError(undefined);
    try {
      const result = await getContextMenuStatus();
      if (request === revision.current) setStatus(result);
    }
    catch (error) { if (request === revision.current) setError(String(error)); }
    finally { if (request === revision.current) setBusy(false); }
  };
  useEffect(() => { void refresh(); return () => { revision.current++; }; }, []);
  const run = async (action: ContextMenuAction) => {
    const request = ++revision.current;
    setBusy(true); setError(undefined);
    try {
      const result = await manageContextMenu(action);
      if (request === revision.current) setStatus(result);
    }
    catch (error) {
      if (request !== revision.current) return;
      setError(String(error));
      const observed = await getContextMenuStatus().catch(() => undefined);
      if (observed && request === revision.current) setStatus(observed);
    }
    finally { if (request === revision.current) setBusy(false); }
  };
  const state = !status ? 'Checking context menu status…' : !status.supported ? 'Requires Windows 11' :
    status.enabled ? 'Enabled' : !status.available ? 'Context menu resources are unavailable' :
    !status.certificateTrusted ? 'Certificate trust required' : 'Disabled';
  return <SettingsGroup title={t('Windows context menu')}>
    <Field layout="stacked" title={t('Open in Vrykell')} description={t('Open a terminal in the selected folder or folder background from the Windows 11 context menu.')}>
      <div aria-live="polite" data-testid="context-menu-status">{t(state)}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        <OutlineButton disabled={busy || !status?.supported || (!status.enabled && (!status.available || !status.certificateTrusted))}
          onClick={() => void run(status?.enabled ? 'disable' : 'enable')}>
          {t(status?.enabled ? 'Disable context menu' : 'Enable context menu')}
        </OutlineButton>
        <OutlineButton disabled={busy} onClick={() => void refresh()}>{t('Refresh status')}</OutlineButton>
      </div>
      {status?.supported && <p className="settings-description">{t('After enabling or disabling the context menu, restart Windows to ensure the change takes effect.')}</p>}
    </Field>
    {status?.supported && status.available && <Field layout="stacked" title={t('Signing certificate')} description={t('The free self-signed package requires certificate trust on this computer. Trust is added only when you choose the button below.')}>
      <div>{t(status.certificateTrusted ? 'Certificate trusted' : 'Certificate trust required')}</div>
      <p className="settings-description">{t('Windows requires administrator approval to add or remove certificate trust. Accept the Windows permission prompt to continue.')}</p>
      {status.certificateThumbprint && <div style={{ overflowWrap: 'anywhere', marginTop: 8 }}>{t('Certificate fingerprint')}: {status.certificateThumbprint}</div>}
      <OutlineButton style={{ marginTop: 12 }} disabled={busy || status.enabled}
        onClick={() => void run(status.certificateTrusted ? 'untrust' : 'trust')}>
        {t(status.certificateTrusted ? 'Remove certificate trust' : 'Trust this certificate')}
      </OutlineButton>
      <p className="settings-description">{t('Trust allows packages signed by this certificate to be installed. Disable the menu before removing trust. The signing private key is never included in the application.')}</p>
    </Field>}
    {error && <ErrorBox title={t('Could not update the context menu')} details={error} detailsTitle={t('Technical details')}
      actions={<OutlineButton disabled={busy} onClick={() => void refresh()}>{t('Retry')}</OutlineButton>}>
      {t('Check the certificate trust and package availability, then try again.')}
    </ErrorBox>}
  </SettingsGroup>;
}
