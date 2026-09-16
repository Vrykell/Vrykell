import { useCallback, useMemo, useState } from 'react';
import { useBlockStore, selectBlocks } from '@entities/terminal';
import { usePaneMessages } from '@entities/chat';
import { useChatPanelOpen } from '@shared/ui';
import { useSearchHighlightStore } from '@entities/search';
import { toExchanges, mergeFlow } from '@features/chat/model/exchanges';
import { agentControl } from '@features/agent/services/agentControl';
import type { TermBlock } from '@features/terminal/services/pipeline/termBlock';
import { hasVisibleContent } from '@features/terminal/model/blockVisibility';

export interface BlockMenuState {
  block: TermBlock;
  rect: DOMRect;
}

/** 聚合块列表需要的显示流、AI 交错内容和菜单状态。 */
export function useTerminalBlockFlow(tabId: string) {
  const blocks = useBlockStore(selectBlocks(tabId));
  const highlightQuery = useSearchHighlightStore((state) => state.query);
  const aiMessages = usePaneMessages(tabId);
  const chatPanelOpen = useChatPanelOpen();
  const [menuBlock, setMenuBlock] = useState<BlockMenuState | null>(null);

  const completed = useMemo(
    () => blocks.filter((block) =>
      (block.status === 'done' || block.status === 'interrupted') && hasVisibleContent(block),
    ),
    [blocks],
  );
  const running = useMemo(() => blocks.filter((block) => block.status === 'executing'), [blocks]);
  const exchanges = useMemo(
    () => (chatPanelOpen ? [] : toExchanges(aiMessages)),
    [aiMessages, chatPanelOpen],
  );
  const standalone = useMemo(
    () => (chatPanelOpen ? completed : completed.filter((block) => !agentControl.hasBlock(block.id))),
    [chatPanelOpen, completed],
  );
  const flow = useMemo(() => mergeFlow(standalone, exchanges), [exchanges, standalone]);
  const allCollapsed = completed.length > 0 && completed.every((block) => block.collapsed);
  const openMenu = useCallback((block: TermBlock, rect: DOMRect) => {
    setMenuBlock({ block, rect });
  }, []);
  const closeMenu = useCallback(() => setMenuBlock(null), []);

  return {
    highlightQuery,
    completed,
    running,
    flow,
    allCollapsed,
    menuBlock,
    openMenu,
    closeMenu,
  };
}
