import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import { useAppBootstrap } from '@/app/hooks/useAppBootstrap';
import AppShell from '@/app/layout/AppShell';
import '@features/search/services/init';

/** 应用组合根：只连接应用生命周期、全局交互和视觉壳。 */
export default function App() {
  useAppBootstrap();
  useGlobalShortcuts();
  return <AppShell />;
}
