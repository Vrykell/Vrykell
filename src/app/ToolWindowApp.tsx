import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { t, useT } from '@i18n';
import { createToolWindowClient } from '@platform/toolWindows';
import { refreshAiConfig } from '@features/agent/stores/aiConfig';
import AutoGroupDialog from '@features/agent/components/AutoGroupDialog';
import type { GroupingItem } from '@features/agent/services/autoGrouping';
import CommandComposer from '@features/command-history/components/CommandComposer';
import type { ExecutionContext } from '@features/command-history/services/execution';
import ErrorBox from '@ui/ErrorBox';
import TooltipLayer from '@ui/TooltipLayer';
import ToolWindow from '@ui/ToolWindow';

type Input = { kind: 'grouping'; input: { items: GroupingItem[]; kind: string } }
  | { kind: 'command'; input: { context: ExecutionContext; recent: string[] } };

/** Tool windows initialize only their editor and model configuration, without terminal startup. */
export default function ToolWindowApp({ token }: { token: string }) {
  useT();
  const [session, setSession] = useState<{ input: Input; client: Awaited<ReturnType<typeof createToolWindowClient>> } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false; let cleanup: (() => void) | undefined;
    void (async () => {
      const client = await createToolWindowClient(token); cleanup = client.dispose;
      if (disposed) { client.dispose(); return; }
      const [input] = await Promise.all([client.ready(), refreshAiConfig()]);
      if (disposed) { client.dispose(); return; }
      if (!['grouping', 'command'].includes(input.kind)) throw new Error(t('The main window did not respond. Reopen this tool.'));
      setSession({ input: input as Input, client });
    })().catch(reason => { if (!disposed) setError(String(reason)); });
    return () => { disposed = true; cleanup?.(); };
  }, [token]);
  const close = () => { void getCurrentWindow().close().catch(reason => setError(String(reason))); };
  if (error) return <ToolWindow label={t('Could not open tool window')} onClose={close} footer={null}>
    <ErrorBox title={t('Could not open tool window')} details={error} />
  </ToolWindow>;
  if (!session) return <div className="history-empty" role="status">{t('Loading…')}</div>;
  const { input, client } = session;
  return <>
    {input.kind === 'grouping' ? <AutoGroupDialog {...input.input} onClose={close} onApply={async groups => { await client.send({ type: 'apply', groups }); }} />
      : <CommandComposer {...input.input} onClose={close}
        onFill={async item => { await client.send({ type: 'fill', item }); }}
        onFavorite={async item => { await client.send({ type: 'favorite', item }); }}
        onSettings={() => { void client.send({ type: 'settings' }).catch(reason => setError(String(reason))); }} />}
    <TooltipLayer />
  </>;
}
