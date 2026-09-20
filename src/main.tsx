import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import App from '@app/App';
import { AppProviders } from '@app/providers/AppProviders';
import { preloadApplication } from '@app/preload';
import '@app/theme.css';

preloadApplication();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('找不到应用挂载节点');

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);
