import type { ReactNode } from 'react';
import ErrorBoundary from '@/components/ErrorBoundary';
import { I18nProvider } from '@/i18n';
import { ThemeProvider } from '@/theme/ThemeProvider';

/** 应用基础 Provider 组合，入口文件只负责挂载，不负责组织依赖。 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <I18nProvider>{children}</I18nProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
