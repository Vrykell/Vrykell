import { useLayoutEffect, useRef } from 'react';
import { useUiStore } from '@features/workspace';
import { IconButton } from '@ui/IconButton';
import { X, iconSizes } from '@ui/icons';
import { t } from '@i18n';
import SettingsView from '../pages/SettingsView';

/** Settings cover the content card while functional navigation remains available. */
export default function SettingsScreen() {
  const ref = useRef<HTMLDivElement>(null);
  const close = () => useUiStore.getState().setSettingsOpen(false);
  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div ref={ref} role="region" aria-label={t('Settings')} tabIndex={-1} className="settings-screen">
    <SettingsView />
    <IconButton className="settings-close" aria-label={t('Close settings')} data-tip={t('Close settings')} onClick={close}>
      <X size={iconSizes.control} />
    </IconButton>
  </div>;
}
