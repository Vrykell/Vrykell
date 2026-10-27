import { useCallback, useMemo, useState } from 'react';
import { useBlockStore, selectBlocks } from '@features/terminal';
import { usePaneMessages } from '@features/chat';
import { useSearchHighlightStore } from '@features/search';
import { toExchanges, mergeFlow } from '@features/chat/model/exchanges';
import { agentControl } from '@features/agent/services/agentControl';
import type { TermBlock } from '@features/terminal/services/pipeline/termBlock';
import { hasVisibleContent } from '@features/terminal/model/blockVisibility';

export interface BlockMenuState {
  block: TermBlock;
  anchor: BlockMenuAnchor;
}

export type BlockMenuAnchor =
  | { kind: 'pointer'; x: number; y: number }
  | { kind: 'control'; left: number; top: number };

/** Aggregates the display flow, interleaved AI content and menu state needed by the block list. */
export function useTerminalBlockFlow(tabId: string) {
  const blocks = useBlockStore(selectBlocks(tabId));
  const highlightQuery = useSearchHighlightStore((state) => state.query);
  const aiMessages = usePaneMessages(tabId);
  const [menuBlock, setMenuBlock] = useState<BlockMenuState | null>(null);

  const completed = useMemo(
    () => blocks.filter((block) =>
      (block.status === 'done' || block.status === 'interrupted') && !block.snapshotPending && hasVisibleContent(block),
    ),
    [blocks],
  );
  const running = useMemo(() => blocks.filter((block) => block.status === 'executing' || block.snapshotPending), [blocks]);
  const exchanges = useMemo(
    () => toExchanges(aiMessages),
    [aiMessages],
  );
  const standalone = useMemo(
    () => {
      const embedded = new Set(aiMessages.flatMap(message => (message.parts ?? []).flatMap(part =>
        part.kind === 'tool' ? [agentControl.blockForToolCall(part.tool.toolCallId)] : [])));
      return completed.filter(block => !embedded.has(block.id));
    },
    [aiMessages, completed],
  );
  const flow = useMemo(() => mergeFlow(standalone, exchanges), [exchanges, standalone]);
  const openMenu = useCallback((block: TermBlock, anchor: BlockMenuAnchor) => {
    setMenuBlock({ block, anchor });
  }, []);
  const closeMenu = useCallback(() => setMenuBlock(null), []);

  return {
    highlightQuery,
    completed,
    running,
    flow,
    menuBlock,
    openMenu,
    closeMenu,
  };
}
