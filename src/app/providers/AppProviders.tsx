import type { ReactNode } from 'react';
import ErrorBoundary from '@ui/feedback/ErrorBoundary';
import { I18nProvider } from '@i18n';
import { ThemeProvider } from '@app/providers/ThemeProvider';

/** Compose application providers so the entry point only mounts the app. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <I18nProvider>{children}</I18nProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
