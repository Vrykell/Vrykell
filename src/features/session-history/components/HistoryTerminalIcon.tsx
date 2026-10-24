import type { BackendSessionEntry } from '@platform/api/types';
import { TerminalProfileIcon } from '@ui/icons/shellIcons';
import { sessionHistoryTerminals } from '../model/sessionMetadata';

export default function HistoryTerminalIcon({ session, size = 18 }: { session: BackendSessionEntry; size?: number }) {
  const terminal = sessionHistoryTerminals(session)[0];
  return <TerminalProfileIcon kind={terminal?.kind} shellType={terminal?.shellType} connectionId={terminal?.remoteId} size={size} />;
}
