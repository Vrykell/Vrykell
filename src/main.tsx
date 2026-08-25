import React from "react";
import ReactDOM from "react-dom/client";
import { I18nProvider } from "./i18n";
import { ThemeProvider } from "./theme/ThemeProvider";
import { applyTheme } from "./theme/tokens";
import { useTerminalThemeStore, applyCachedWallpaper } from "./theme/terminalTheme";
import ErrorBoundary from "./components/ErrorBoundary";
import { installGlobalErrorHandlers } from "./lib/errorHandler";
import App from "./App";
import "./theme.css";

// 首屏同步写入 CSS 变量，避免 FOUC（Flash of Unstyled Content）
applyTheme((document.documentElement.dataset.theme as 'dark' | 'light') || 'dark');

// 先同步应用上次缓存的壁纸（避免启动黑屏），再异步加载真实配置
applyCachedWallpaper();
void useTerminalThemeStore.getState().load();

// 全局异常捕获（console 输出，不静默吞掉）
installGlobalErrorHandlers();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <I18nProvider>
          <App />
        </I18nProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
