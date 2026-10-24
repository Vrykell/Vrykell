import { useEffect, useState } from 'react';
import type { EditorFile } from '@core/editor';
import { openInTerminal } from '@features/files';
import { isWindows } from '@platform/runtime';
import ContextMenu, { type MenuAnchor } from '@ui/menus/ContextMenu';
import { TextButton } from '@ui/actions/TextButton';
import { Lock } from '@ui/icons';
import { useToastStore } from '@ui/feedback/Toast';
import { t } from '@i18n';

/** File access stays read-only until the user explicitly requests the existing elevation flow. */
export default function ReadOnlyFileAccess({ file, permissionDenied, active }: { file: EditorFile; permissionDenied?: boolean; active: boolean }) {
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  useEffect(() => { if (!active) setMenu(null); }, [active]);
  const elevatedLabel = t(!file.connectionId && isWindows ? 'Open as administrator' : 'Open with sudo in terminal');
  return <>
    <TextButton className="editor-readonly-label" aria-label={t('Read-only')} aria-haspopup="menu" aria-expanded={!!menu}
      data-tip={t('File permissions')} onClick={event => {
        const trigger = event.currentTarget; const bounds = trigger.getBoundingClientRect();
        setMenu(current => current ? null : { x: bounds.left, y: bounds.bottom, trigger });
      }}><Lock size={12} />{t('Read-only')}</TextButton>
    {menu && <ContextMenu anchor={menu} label={t('File permissions')} onClose={() => setMenu(null)}
      description={t(permissionDenied ? 'Your current user cannot access or write this file. Open it with elevated permissions to edit.' : 'This file is read-only. Editing and saving are disabled.')}
      items={[{ label: elevatedLabel, onClick: () => {
        void openInTerminal(file, true).catch(reason => useToastStore.getState().addToast(String(reason), 'error'));
      } }]} />}
  </>;
}
