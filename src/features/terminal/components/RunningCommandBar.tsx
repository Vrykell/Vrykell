import { t } from '@i18n';
import { CircleX, Maximize2, Square, Zap } from '@ui/icons';
import { useTypographyStore } from '@config/typography';
import { useTuiControls } from '../hooks/useTuiControls';
import type { TermBlock } from '../services/pipeline/termBlock';
import { STATUS_ACTION_ICON_SIZE, StatusActionButton, TerminalStatusBar } from './TerminalStatusBar';
import { TerminalRedrawButton } from './TerminalRedrawButton';
import CommandSyntax from './CommandSyntax';

/** The original and viewport-pinned running headers expose the same controls. */
export default function RunningCommandBar({ block, paneId, pinned = false, collapsed = false }: {
  block: TermBlock; paneId: string; pinned?: boolean; collapsed?: boolean;
}) {
  const { sendCtrlC, killApp, killArmed, enterFullScreen } = useTuiControls(paneId);
  const colored = useTypographyStore(state => state.commandHighlighting);
  const showContext = !pinned || !collapsed;
  return <TerminalStatusBar cwd={showContext ? block.cwd : undefined} startedAt={showContext ? block.startedAt : undefined} gitBranch={showContext ? block.gitBranch : undefined}
    label={pinned && showContext ? colored ? <CommandSyntax text={block.command} /> : block.command : undefined} alwaysShowActions={pinned}
    agent={showContext && block.agent ? <Zap size={14} className="command-status-agent" aria-label={t('AI execution')} /> : undefined}
    actions={<>
      <TerminalRedrawButton paneId={paneId} />
      <StatusActionButton title={t('Interrupt command')} shortcut="Control+C" onClick={sendCtrlC} label={<Square size={STATUS_ACTION_ICON_SIZE} />} />
      <StatusActionButton title={killArmed ? t('Force quit foreground process') : t('Quit foreground process')} onClick={killApp} label={<CircleX size={STATUS_ACTION_ICON_SIZE} />} />
      <StatusActionButton title={t('Enter fullscreen interaction')} onClick={enterFullScreen} label={<Maximize2 size={STATUS_ACTION_ICON_SIZE} />} />
    </>} />;
}
