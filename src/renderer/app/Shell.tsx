import React, { useEffect, useRef, useState } from 'react';
import { TerminalView, TerminalTabs } from '../features/terminal';
import { RichOutput, useRichContent } from '../features/rich-content';
import { AIChatPanel } from '../features/ai';
import { StatusBar } from '../components/layout/StatusBar';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { useTerminalStore } from '@renderer/stores/terminal-store';
import { t } from '../i18n';
import { closePTY, exitApp } from '../../api';
import { useSessionLifecycle } from './hooks/useSessionLifecycle';
import { useBackendEvents } from './hooks/useBackendEvents';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';

/**
 * Application shell — root layout, backend event wiring, session
 * auto-creation, global shortcuts, and close/exit confirmation dialogs.
 */
export const Shell: React.FC = () => {
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const sessions = useTerminalStore((s) => s.sessions);
  const outputPanelOpen = useTerminalStore((s) => s.outputPanelOpen);
  const toggleOutputPanel = useTerminalStore((s) => s.toggleOutputPanel);

  const [showExitDialog, setShowExitDialog] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);

  const { createAndAddSession } = useSessionLifecycle();
  useBackendEvents(createAndAddSession);
  useRichContent(activeSessionId);

  // Closing the LAST tab goes straight to the exit dialog — showing the
  // force-close dialog first would make the user confirm twice.
  const requestCloseTab = (id: string) => {
    if (useTerminalStore.getState().sessions.length <= 1) {
      setShowExitDialog(true);
    } else {
      setClosingId(id);
    }
  };

  useGlobalShortcuts({
    onNewTab: createAndAddSession,
    onCloseActiveTab: () => {
      if (activeSessionId) requestCloseTab(activeSessionId);
    },
  });

  // Auto-create first session on startup; show exit dialog when last closed.
  const didInitRef = useRef(false);
  useEffect(() => {
    if (sessions.length > 0) return;
    if (!didInitRef.current) {
      didInitRef.current = true;
      createAndAddSession();
    } else {
      setShowExitDialog(true);
    }
  }, [sessions.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="app-shell">
        <TerminalTabs onCloseTab={requestCloseTab} />
        <div className="app-main">
          <div className="app-terminal-area">
            <TerminalView sessionId={activeSessionId} />
            {outputPanelOpen && <RichOutput />}
            {!outputPanelOpen && (
              <button className="rich-output-toggle" onClick={toggleOutputPanel} title="Toggle Rich Output (Ctrl+Shift+R)">
                📄 Rich Output
              </button>
            )}
          </div>
          <AIChatPanel />
        </div>
        <StatusBar />
      </div>

      <ConfirmDialog
        open={showExitDialog}
        title={t.exit.title}
        message={t.exit.message}
        confirmLabel={t.exit.confirm}
        cancelLabel={t.exit.cancel}
        danger
        onConfirm={() => exitApp().catch(() => window.close())}
        onCancel={() => {
          setShowExitDialog(false);
          // Dialog reached via last-tab close: the session is still alive,
          // so cancel simply dismisses. Only recreate when the last shell
          // already exited on its own (sessions is empty).
          if (useTerminalStore.getState().sessions.length === 0) createAndAddSession();
        }}
      />

      <ConfirmDialog
        open={closingId !== null}
        title={t.closeTab.title}
        message={t.closeTab.message}
        confirmLabel={t.closeTab.confirm}
        cancelLabel={t.closeTab.cancel}
        danger
        onConfirm={() => {
          if (closingId) {
            closePTY(closingId).catch(() => {});
            setClosingId(null);
          }
        }}
        onCancel={() => setClosingId(null)}
      />
    </>
  );
};
