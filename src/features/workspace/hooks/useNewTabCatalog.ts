import { useEffect, useMemo, useState } from 'react';
import { useShellProfiles } from '@config/shellProfiles';
import { useTerminalDefaults } from '@config/terminalDefaults';
import { ensureSshLoaded, useSshStore } from '@features/ssh';
import { getAvailableShells, type ShellOption } from '@platform/shells';
import { buildNewTabOptions, loadRecentOpen } from '../model/tabTypes';

export function useNewTabCatalog(open: boolean) {
  const [shells, setShells] = useState<ShellOption[]>([]);
  const defaultShell = useTerminalDefaults(state => state.shell);
  const profiles = useShellProfiles(state => state.profiles);
  const sshConnections = useSshStore(state => state.connections);
  useEffect(() => {
    if (!open) return;
    let disposed = false; ensureSshLoaded();
    void getAvailableShells().then(value => { if (!disposed) setShells(value); });
    return () => { disposed = true; };
  }, [open]);
  const allOptions = useMemo(() => buildNewTabOptions(shells, sshConnections, loadRecentOpen(), defaultShell)
    .map(option => option.kind === 'shell' && profiles[option.shellType]?.name ? { ...option, label: profiles[option.shellType]!.name } : option), [shells, sshConnections, defaultShell, profiles]);
  return { shells, defaultShell, profiles, sshConnections, allOptions };
}
