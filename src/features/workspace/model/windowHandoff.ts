import { z } from 'zod';
import { EDITOR_ENCODINGS, editorFileKey, type EditorEncoding } from '@core/editor';
import { parseWorkspacePaneLayout, workspacePaneCells } from './workspaceResources';
import { leaves, parseWindowLayout } from './windowLayout';
import { isHistoryGroupColor } from '@ui/history/historyGroupColor';
import { acceptsWorkspaceResource, WORKSPACE_SCOPES } from './workbench';

const MAX_TEXT = 16 * 1024 * 1024;
const encoding = z.enum(Object.keys(EDITOR_ENCODINGS) as [EditorEncoding, ...EditorEncoding[]]);
const reference = z.string().min(1).max(2048);
const editorFile = z.object({
  path: reference,
  connectionId: reference.optional(),
  draftId: reference.optional(),
  encoding: encoding.optional(),
});
const document = z.object({
  file: editorFile,
  kind: z.enum(['text', 'binary', 'tooLarge']),
  text: z.string().max(MAX_TEXT),
  value: z.string().max(MAX_TEXT),
  revision: z.string().max(4096),
  error: z.string().max(16_384),
  readOnly: z.boolean().optional(),
  permissionDenied: z.boolean().optional(),
  encoding: encoding.optional(),
});
const block = z.object({
  id: reference,
  command: z.string(),
  cwd: z.string().max(8192).optional(),
  gitBranch: z.string().max(4096).optional(),
  status: z.enum(['done', 'interrupted']),
  exitCode: z.number().nullable(),
  startedAt: z.number().nullable(),
  endedAt: z.number().nullable(),
  wasLongRunning: z.boolean(),
  agent: z.boolean().optional(),
  outputHtml: z.string(),
  outputText: z.string(),
  outputRaw: z.string(),
  linesTruncated: z.number(),
});
const terminalHandoff = z.object({
  version: z.literal(1),
  id: reference,
  scope: z.literal('terminal'),
  title: z.string().max(320),
  draftTimestamp: z.number().finite().nonnegative().optional(),
  focused: reference,
  layout: z.unknown(),
  titleSource: z.enum(['ai', 'command', 'message', 'manual']).optional(),
  terminals: z
    .array(
      z.object({
        paneId: reference,
        sessionId: z.string().min(1).max(64),
        inputEpoch: z.number().int().nonnegative(),
        cwd: z.string().max(8192).optional(),
        shell: z.string().max(64).optional(),
        draft: z
          .object({
            text: z.string().max(MAX_TEXT),
            aiMode: z.boolean(),
            commandDraft: z.string().max(MAX_TEXT).optional(),
            aiDraft: z.string().max(MAX_TEXT).optional(),
          })
          .optional(),
        blocks: z.array(block).max(5000),
      }),
    )
    .min(1)
    .max(4),
});

function parseTerminalHandoff(value: unknown) {
  const result = terminalHandoff.safeParse(value);
  if (!result.success) return null;
  const data = result.data;
  const layout = parseWindowLayout(data.layout);
  if (!layout) return null;
  const paneIds = new Set(data.terminals.map((pane) => pane.paneId));
  const sessionIds = new Set(data.terminals.map((pane) => pane.sessionId));
  const terminals = leaves(layout);
  if (
    paneIds.size !== data.terminals.length ||
    sessionIds.size !== paneIds.size ||
    terminals.length !== paneIds.size ||
    terminals.some((pane) => !paneIds.has(pane.id)) ||
    !paneIds.has(data.focused) ||
    JSON.stringify(data).length > MAX_TEXT
  )
    return null;
  return { ...data, layout };
}
export type TerminalWindowHandoff = NonNullable<ReturnType<typeof parseTerminalHandoff>>;

const path = z.string().max(8192);
const draft = z.object({
  text: z.string().max(MAX_TEXT),
  attachments: z
    .array(
      z.object({
        id: reference,
        kind: z.enum(['image', 'file', 'paste']),
        name: reference,
        mime: z.string().max(256),
        size: z.number().nonnegative(),
        textContent: z.string().max(MAX_TEXT).optional(),
        blobPath: path.optional(),
      }),
    )
    .max(256),
  references: z
    .array(
      z.object({
        id: reference,
        paneId: reference,
        label: reference,
        command: z.string().max(MAX_TEXT),
        output: z.string().max(MAX_TEXT),
        cwd: path.optional(),
        createdAt: z.number(),
        exitCode: z.number().nullish(),
      }),
    )
    .max(256)
    .optional(),
});
const handoff = z.object({
  version: z.literal(1),
  id: reference,
  scope: z.enum(['code', 'ai', 'unified']),
  title: z.string().max(320).optional(),
  focused: reference,
  layout: z.unknown(),
  documents: z.array(document).max(4),
  terminals: z.array(z.unknown()).max(4).optional(),
  conversations: z
    .array(
      z.object({
        id: reference,
        title: z.string().max(320),
        createdAt: z.number(),
        updatedAt: z.number(),
        projectDirectory: path.optional(),
        environment: z
          .object({
            paneId: reference,
            label: reference,
            kind: z.enum(['local', 'ssh']),
            cwd: path.optional(),
            shellType: z.string().max(64).optional(),
            aiNotes: z.string().max(16384).optional(),
            ssh: z.object({ host: reference, user: reference.optional(), port: z.number().int().min(1).max(65535).optional() }).optional(),
          })
          .nullable(),
        draft: draft.optional(),
      }),
    )
    .max(4)
    .optional(),
  agents: z
    .array(z.object({ id: reference, harness: reference, cwd: path, resumeSessionId: reference.optional(), draft: draft.optional() }))
    .max(4)
    .optional(),
  comparisons: z
    .array(
      z.object({
        id: reference,
        selection: z.object({
          target: z.object({ cwd: path, connectionId: reference.optional() }),
          paneId: z.string().max(2048),
          path: reference,
          scope: z.enum(['unstaged', 'staged', 'untracked', 'conflicts']),
        }),
      }),
    )
    .max(4)
    .optional(),
});

export function parseWindowHandoff(value: unknown) {
  if (value && typeof value === 'object' && 'scope' in value && value.scope === 'terminal') return parseTerminalHandoff(value);
  const result = handoff.safeParse(value);
  if (!result.success) return null;
  const { terminals: entries, ...data } = result.data;
  const layout = parseWorkspacePaneLayout(data.layout);
  if (!layout) return null;
  const panes = workspacePaneCells(layout);
  const terminals = entries?.map(parseTerminalHandoff);
  if (terminals?.some((tab) => !tab)) return null;
  const terminalTabs = terminals?.filter((tab): tab is TerminalWindowHandoff => !!tab);
  if (
    terminalTabs &&
    (new Set(terminalTabs.map((tab) => tab.id)).size !== terminalTabs.length || terminalTabs.some((tab) => tab.id === data.id))
  )
    return null;
  const resources = [
    ...data.documents.map((item) => `file:${editorFileKey(item.file)}`),
    ...(data.conversations ?? []).map((item) => `chat:${item.id}`),
    ...(data.agents ?? []).map((item) => `acp:${item.id}`),
    ...(data.comparisons ?? []).map((item) => `diff:${item.id}`),
    ...(terminalTabs ?? []).flatMap((tab) => tab.terminals.map((pane) => `terminal:${pane.paneId}`)),
  ];
  const references = new Set(resources);
  if (
    references.size !== resources.length ||
    references.size !== panes.length ||
    panes.some((pane) => !references.has(pane.resourceId) || !acceptsWorkspaceResource(data.scope, pane.resourceId)) ||
    !panes.some((pane) => pane.id === data.focused) ||
    JSON.stringify(data).length > MAX_TEXT
  )
    return null;
  return { ...data, layout, ...(terminalTabs ? { terminals: terminalTabs } : {}) };
}

export type TabWindowHandoff = NonNullable<ReturnType<typeof parseWindowHandoff>>;

export const terminalTabsInHandoff = (tab: TabWindowHandoff) => (tab.scope === 'terminal' ? [tab] : (tab.terminals ?? []));

const groupHandoff = z.object({
  version: z.literal(1),
  group: z.object({ id: reference, scope: z.enum(WORKSPACE_SCOPES), title: z.string().min(1).max(320), collapsed: z.boolean() }),
  selected: reference.optional(),
  color: z.string().optional(),
  tabs: z.array(z.unknown()).min(1).max(32),
});

export function parseGroupWindowHandoff(value: unknown) {
  const result = groupHandoff.safeParse(value);
  if (!result.success) return null;
  const { tabs: entries, color, selected, ...data } = result.data;
  const tabs = entries.flatMap((entry) => {
    const tab = parseWindowHandoff(entry);
    return tab && tab.scope === data.group.scope ? [tab] : [];
  });
  const ids = new Set(tabs.map((tab) => tab.id));
  const resources = tabs.flatMap((tab) =>
    tab.scope === 'terminal'
      ? tab.terminals.map((pane) => `terminal:${pane.paneId}`)
      : workspacePaneCells(tab.layout).map((pane) => pane.resourceId),
  );
  const terminalTabs = tabs.flatMap(terminalTabsInHandoff);
  const sessions = terminalTabs.flatMap((tab) => tab.terminals.map((pane) => pane.sessionId));
  if (
    tabs.length !== entries.length ||
    ids.size !== tabs.length ||
    (selected && !ids.has(selected)) ||
    new Set(resources).size !== resources.length ||
    new Set(sessions).size !== sessions.length ||
    new Set(terminalTabs.map((tab) => tab.id)).size !== terminalTabs.length ||
    JSON.stringify(tabs).length > MAX_TEXT
  )
    return null;
  return { ...data, tabs, selected, color: isHistoryGroupColor(color) ? color : undefined };
}
