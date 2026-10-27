import { useGlobalShortcuts } from '@app/hooks/useGlobalShortcuts';
import { useAppBootstrap } from '@app/hooks/useAppBootstrap';
import AppShell from '@app/layout/AppShell';
import { useT } from '@i18n';
import '@features/search/services/init';

/** Application composition root: wires only the app lifecycle, global interactions and the visual shell. */
export default function App() {
  useT();
  useAppBootstrap();
  useGlobalShortcuts();
  return <AppShell />;
}
