import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import App from '@app/App';
import ToolWindowApp from '@app/ToolWindowApp';
import { AppProviders } from '@app/providers/AppProviders';
import { preloadApplication } from '@app/preload';
import { loadBundledFonts } from '@config/bundledFonts';
import { diagnostic } from '@platform/diagnostics';
import '@app/theme.css';

const toolWindowToken = new URLSearchParams(window.location.search).get('toolWindow');
if (toolWindowToken) document.documentElement.dataset.toolWindow = 'true';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('找不到应用挂载节点');

preloadApplication();
const fontsStarted = performance.now();
void loadBundledFonts().then(() => {
  if (new URLSearchParams(window.location.search).has('workspaceFrom')) {
    diagnostic('workspace-window-boot', { moduleMs: Math.round(fontsStarted), fontsMs: Math.round(performance.now() - fontsStarted) });
  }
  createRoot(rootElement).render(
    <StrictMode>
      <AppProviders>{toolWindowToken ? <ToolWindowApp token={toolWindowToken} /> : <App />}</AppProviders>
    </StrictMode>,
  );
});
