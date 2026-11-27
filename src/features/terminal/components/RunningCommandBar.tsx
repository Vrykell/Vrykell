import { t } from '@i18n';
import { CircleX, Maximize2, Square, Zap } from '@ui/icons';
import { useTuiControls } from '../hooks/useTuiControls';
import type { TermBlock } from '../services/pipeline/termBlock';
import { STATUS_ACTION_ICON_SIZE, StatusActionButton, TerminalStatusBar } from './TerminalStatusBar';
import { TerminalRedrawButton } from './TerminalRedrawButton';

export default function RunningCommandBar({ block, paneId }: { block: TermBlock; paneId: string }) {
  const { sendCtrlC, killApp, killArmed, enterFullScreen } = useTuiControls(paneId);
  return (
    <TerminalStatusBar
      cwd={block.cwd}
      startedAt={block.startedAt}
      gitBranch={block.gitBranch}
      agent={block.agent ? <Zap size={14} className="command-status-agent" aria-label={t('AI execution')} /> : undefined}
      actions={
        <>
          <TerminalRedrawButton paneId={paneId} />
          <StatusActionButton
            title={t('Interrupt command')}
            shortcut="Control+C"
            onClick={sendCtrlC}
            label={<Square size={STATUS_ACTION_ICON_SIZE} />}
          />
          <StatusActionButton
            title={killArmed ? t('Force quit foreground process') : t('Quit foreground process')}
            onClick={killApp}
            label={<CircleX size={STATUS_ACTION_ICON_SIZE} />}
          />
          <StatusActionButton
            title={t('Enter fullscreen interaction')}
            onClick={enterFullScreen}
            label={<Maximize2 size={STATUS_ACTION_ICON_SIZE} />}
          />
        </>
      }
    />
  );
}
