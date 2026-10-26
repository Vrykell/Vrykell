import { t } from '@i18n';
import AppMark from '@ui/icons/AppMark';
import { DataUsage, History } from '@ui/icons';
import { tabCapabilities, type TabHandle } from '@ui/layout/tabHandle';
import { harnessMark } from '@features/agent/components/HarnessBadge';
import type { Tab } from '@features/workspace';
import { orderProjected } from '@features/workspace/model/tabStrip';
import type { Conversation } from './conversation';

/** The subset of a harness connection the strip needs. */
export interface AiConnectionRow {
  id: string;
  harness: string;
  cwd: string;
}

export interface AiTabInput {
  nativeTabs: string[];
  conversations: Conversation[];
  connections: AiConnectionRow[];
  systemPages: Tab[];
  sideSelected: string;
  sideSessions: string[];
  order: string[];
}

export type AiTabTarget =
  | { kind: 'conversation'; conversationId: string; handle: TabHandle }
  | { kind: 'agent'; connectionId: string; handle: TabHandle }
  | { kind: 'page'; pageId: string; handle: TabHandle };

/**
 * Project native conversations, ACP connections and system pages into one AI strip.
 *
 * Rows come from three stores, so the handle id is the only identity the strip shares.
 */
export function projectAiTabs(input: AiTabInput): AiTabTarget[] {
  const { nativeTabs, conversations, connections, systemPages, sideSelected, sideSessions, order } = input;
  const targets: AiTabTarget[] = [];

  for (const id of nativeTabs) {
    const conversation = conversations.find(item => item.id === id);
    const handleId = `chat:${id}`;
    if (!conversation || sideSessions.includes(handleId) || handleId === sideSelected) continue;
    targets.push({
      kind: 'conversation',
      conversationId: id,
      handle: {
        id: handleId,
        label: conversation.title,
        tip: conversation.title,
        icon: <AppMark colored size={16} />,
        closeLabel: t('Close session {{name}}', { name: conversation.title }),
        capabilities: tabCapabilities({ renameable: true }),
      },
    });
  }

  for (const connection of connections) {
    const handleId = `acp:${connection.id}`;
    if (handleId === sideSelected || sideSessions.includes(handleId)) continue;
    const Mark = harnessMark(connection.harness);
    targets.push({
      kind: 'agent',
      connectionId: connection.id,
      handle: {
        id: handleId,
        label: connection.harness,
        tip: connection.cwd ? `${connection.harness} · ${connection.cwd}` : connection.harness,
        icon: <Mark size={16} />,
        closeLabel: t('Close session {{name}}', { name: connection.harness }),
        capabilities: tabCapabilities(),
      },
    });
  }

  for (const page of systemPages) {
    if (page.kind !== 'ai-history' && page.kind !== 'usage' && page.kind !== 'start-ai') continue;
    targets.push({
      kind: 'page',
      pageId: page.id,
      handle: {
        id: `page:${page.id}`,
        label: page.title,
        tip: page.title,
        icon: page.kind === 'usage' ? <DataUsage size={16} /> : page.kind === 'start-ai' ? <AppMark colored size={16} /> : <History size={16} />,
        closeLabel: t('Close this tab'),
        surface: 'canvas',
        dataAttributes: { 'data-tab-kind': page.kind },
        capabilities: tabCapabilities(),
      },
    });
  }

  return orderProjected(targets, order);
}
