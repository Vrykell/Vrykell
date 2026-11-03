import { useEffect, useState } from 'react';
import { t } from '@i18n';
import { openProjectPage, supportsAppUpdates } from '@platform/updater';
import { OutlineButton } from '@ui/actions/OutlineButton';
import CopyButton from '@ui/actions/CopyButton';
import AppMark from '@ui/icons/AppMark';
import { fmtSize } from '@ui/actions/UiBtn';
import ErrorBox from '@ui/feedback/ErrorBox';
import ConfirmDialog from '@ui/feedback/ConfirmDialog';
import { ProgressBar } from '@ui/feedback/ProgressBar';
import { SettingsGroup, Field } from '../components/ui';
import { useAppUpdate } from '../stores/appUpdate';
import './aboutPage.css';

export function AboutPage() {
  const update = useAppUpdate();
  const [confirm, setConfirm] = useState(false);
  const [linkError, setLinkError] = useState('');
  const guidance = update.operation === 'download' ? t('The update could not be downloaded or verified. Retry the download or check the published release.')
    : update.operation === 'install' ? t('Installation did not finish. Resolve the reported problem and retry when you are ready to close terminal connections.')
    : update.operation === 'restart' ? t('The update is installed. Save your work and restart the application to finish.')
    : t('Check your connection and try again. Updates require a published, signed stable release.');
  useEffect(() => { void update.loadVersion(); }, [update.loadVersion]);
  const busy = ['checking', 'downloading', 'installing', 'restarting'].includes(update.phase);
  const downloading = update.phase === 'downloading';
  const downloadPercent = downloading && update.total
    ? Math.min(100, Math.max(0, update.downloaded / update.total * 100))
    : 0;
  const supported = supportsAppUpdates();
  const status = !supported ? t('Updates are available in the installed desktop application.')
    : update.phase === 'current' ? t('You are using the latest stable version.')
    : update.phase === 'checking' ? t('Checking for updates…')
    : update.phase === 'available' ? t('Version {{version}} is available.', { version: update.version })
    : update.phase === 'downloading' ? t('Downloading update · {{size}}', { size: fmtSize(update.downloaded) })
    : update.phase === 'ready' ? t('The update is verified and ready to install.')
    : update.phase === 'installing' ? t('Installing update…')
    : update.phase === 'restarting' ? t('Restarting…')
    : update.phase === 'installed' ? t('The update is installed. Restart to finish.')
    : t('Only stable releases are offered.');
  const label = update.phase === 'available' ? t('Download update')
    : update.phase === 'downloading' ? t('Downloading…')
    : update.phase === 'ready' ? t('Install and restart')
    : update.phase === 'installed' ? t('Restart to finish')
    : update.phase === 'installing' ? t('Installing…')
    : update.phase === 'restarting' ? t('Restarting…')
    : update.phase === 'checking' ? t('Checking…') : t('Check for updates');
  const act = () => {
    if (update.phase === 'ready' || update.phase === 'installed') setConfirm(true);
    else if (update.phase === 'available') void update.download();
    else void update.check();
  };
  const link = (page: 'project' | 'releases' | 'license') => {
    setLinkError('');
    void openProjectPage(page).catch(error => setLinkError(String(error)));
  };
  return <>
    <section className="about-product" aria-label={t('Application information')}>
      <AppMark size={72} />
      <div><h2>Vrykell</h2><p>{t('Your workspace for local and remote terminals.')}</p></div>
    </section>
    <SettingsGroup title={t('Software updates')}>
      <Field title={t('Version')}><div className="about-version"><span data-selectable data-testid="application-version">{update.currentVersion || t('Loading…')}</span>{update.currentVersion && <CopyButton quiet text={update.currentVersion} label={t('Copy version')} />}</div></Field>
      <Field title={t('Stable releases')} description={<span role="status" aria-live="polite">{status}</span>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 220, maxWidth: '100%' }}>
          <OutlineButton className="primary-button about-update-button" disabled={busy || !supported} onClick={act}
            data-downloading={downloading || undefined}
            style={downloading ? { backgroundSize: `${downloadPercent}% 100%` } : undefined}>
            {label}
          </OutlineButton>
          {downloading && !!update.total && <div className="about-update-accessible-progress">
            <ProgressBar value={downloadPercent} label={t('Update download')} />
          </div>}
        </div>
      </Field>
      {update.notes && <Field title={t('Release notes')} layout="stacked"><div className="scroll-region" data-selectable style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 180, overflowY: 'auto' }}>{update.notes}</div></Field>}
    </SettingsGroup>
    <footer className="about-footer">
      <nav aria-label={t('Project resources')}><OutlineButton onClick={() => link('project')}>{t('Project homepage')}</OutlineButton><OutlineButton onClick={() => link('releases')}>{t('View releases')}</OutlineButton><OutlineButton aria-label={t('License')} onClick={() => link('license')}>Apache-2.0</OutlineButton></nav>
      <p>{t('© {{year}} Vrykell contributors', { year: 2026 })}</p>
    </footer>
    {update.error && <ErrorBox title={t('Could not update the application')} details={update.error} onDismiss={update.clearError}
      actions={<OutlineButton disabled={busy} onClick={act}>{t('Retry')}</OutlineButton>}>{guidance}</ErrorBox>}
    {linkError && <ErrorBox title={t('Could not open the link')} details={linkError} onDismiss={() => setLinkError('')} />}
    <ConfirmDialog open={confirm} title={update.phase === 'installed' ? t('Restart application?') : t('Install update and restart?')} message={t('The application will restart and terminal connections will close. Save your work before continuing.')} confirmLabel={update.phase === 'installed' ? t('Restart to finish') : t('Install and restart')} cancelLabel={t('Later')}
      onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); update.install(); }} />
  </>;
}
