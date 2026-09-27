import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChatStore } from '@features/chat';
import { useBlockStore } from '@features/terminal';
import { copyBlockText, rerunBlockCommand } from '@features/terminal/services/blockActions';
import type { TermBlock } from '@features/terminal/services/pipeline/termBlock';

interface UseBlockItemActionsOptions {
  tabId: string;
  block: TermBlock;
}

/** Coordinates completed command block actions: rerun, explain, copy, collapse, and bookmark. */
export function useBlockItemActions({ tabId, block }: UseBlockItemActionsOptions) {
  const send = useChatStore((state) => state.send);
  const [copiedAction, setCopiedAction] = useState<'command' | 'output' | null>(null);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCollapsed = !!block.collapsed;
  const copyOutput = useMemo(
    () => block.outputText || block.outputRaw.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, ''),
    [block.outputRaw, block.outputText],
  );

  useEffect(() => () => {
    if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
  }, []);

  const markCopied = useCallback((action: 'command' | 'output', text: string) => {
    void copyBlockText(text).then((success) => {
      if (!success) return;
      setCopiedAction(action);
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
      copyResetTimer.current = setTimeout(() => setCopiedAction(null), 1200);
    });
  }, []);

  const rerun = useCallback(() => {
    void rerunBlockCommand(tabId, block.command);
  }, [block.command, tabId]);

  const askAI = useCallback(() => {
    const plain = copyOutput.slice(0, 2000);
    send(`解释:\n\`\`\`\n${block.command}\n${plain}\n\`\`\``, { paneId: tabId });
  }, [block.command, copyOutput, send, tabId]);

  const copyCmd = useCallback(() => {
    markCopied('command', block.command);
  }, [block.command, markCopied]);

  const copyOut = useCallback(() => {
    markCopied('output', copyOutput);
  }, [copyOutput, markCopied]);

  const toggleCollapsed = useCallback(() => {
    useBlockStore.getState().setBlockCollapsed(tabId, block.id, !isCollapsed);
  }, [block.id, isCollapsed, tabId]);

  const toggleBookmark = useCallback(() => {
    useBlockStore.getState().toggleBookmark(tabId, block.id);
  }, [block.id, tabId]);

  return {
    isCollapsed,
    copiedAction,
    copyOutput,
    rerun,
    askAI,
    copyCmd,
    copyOut,
    toggleCollapsed,
    toggleBookmark,
  };
}
