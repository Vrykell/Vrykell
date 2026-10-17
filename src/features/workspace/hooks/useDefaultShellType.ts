import { useEffect, useState } from 'react';
import { preferredShell, useTerminalDefaults } from '@config/terminalDefaults';
import { fallbackShells, getAvailableShells } from '@platform/shells';

/** Resolve an unspecified local terminal against the configured or machine default. */
export function useDefaultShellType() {
  const preference = useTerminalDefaults(state => state.shell);
  const [shells, setShells] = useState(fallbackShells);
  useEffect(() => {
    let active = true;
    void getAvailableShells().then(value => { if (active) setShells(value); });
    return () => { active = false; };
  }, []);
  return preferredShell(preference, shells);
}
