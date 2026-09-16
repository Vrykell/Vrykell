import { useCallback, useMemo } from 'react';
import { ptyWrite } from '@/platform/pty';
import { useChatStore } from '@entities/chat';
import { useBlockStore, useTerminalStore } from '@entities/terminal';
import type { TermBlock } from '@features/terminal/services/pipeline/termBlock';

interface UseBlockItemActionsOptions {
  tabId: string;
  block: TermBlock;
}

/** 收敛已完成命令块的操作：重跑、解释、复制、折叠和书签。 */
export function useBlockItemActions({ tabId, block }: UseBlockItemActionsOptions) {
  const send = useChatStore((state) => state.send);
  const isCollapsed = !!block.collapsed;
  const copyOutput = useMemo(
    () => block.outputText || block.outputRaw.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, ''),
    [block.outputRaw, block.outputText],
  );

  const rerun = useCallback(() => {
    const sessionId = useTerminalStore.getState().sessions[tabId];
    if (sessionId) ptyWrite(sessionId, block.command + '\n').catch(() => {});
  }, [block.command, tabId]);

  const askAI = useCallback(() => {
    const plain = copyOutput.slice(0, 2000);
    send(`解释:\n\`\`\`\n${block.command}\n${plain}\n\`\`\``, { paneId: tabId });
  }, [block.command, copyOutput, send, tabId]);

  const copyCmd = useCallback(() => {
    navigator.clipboard.writeText(block.command).catch(() => {});
  }, [block.command]);

  const copyOut = useCallback(() => {
    navigator.clipboard.writeText(copyOutput).catch(() => {});
  }, [copyOutput]);

  const toggleCollapsed = useCallback(() => {
    useBlockStore.getState().setBlockCollapsed(tabId, block.id, !isCollapsed);
  }, [block.id, isCollapsed, tabId]);

  const toggleBookmark = useCallback(() => {
    useBlockStore.getState().toggleBookmark(tabId, block.id);
  }, [block.id, tabId]);

  return { isCollapsed, copyOutput, rerun, askAI, copyCmd, copyOut, toggleCollapsed, toggleBookmark };
}
