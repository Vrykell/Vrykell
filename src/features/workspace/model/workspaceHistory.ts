import { parseWorkspacePaneLayout, workspacePaneCells, type WorkspacePaneLayout } from './workspaceResources';

export interface WorkspaceHistoryMember {
  id: string;
  title: string;
  kind: 'terminal' | 'conversation' | 'agent' | 'document' | 'comparison';
  reference: string;
  paneCount: number;
  local: boolean;
  ssh: boolean;
  cwd?: string;
  connectionId?: string;
  draftId?: string;
  remoteId?: string;
  paneId?: string;
  shellType?: string;
  scope?: 'staged' | 'unstaged' | 'untracked' | 'conflicts';
  modes?: ('block' | 'classic')[];
  /** A starter pane with no persisted session content. */
  empty?: boolean;
}

export interface WorkspaceHistorySnapshot {
  version: 1;
  layout: WorkspacePaneLayout;
  focused: string;
  members: WorkspaceHistoryMember[];
}

export interface WorkspaceHistoryIdentity { id: string; createdAt: number }

const kinds = new Set(['terminal', 'conversation', 'agent', 'document', 'comparison']);
const scopes = new Set(['staged', 'unstaged', 'untracked', 'conflicts']);

export function parseWorkspaceHistory(payload: string): WorkspaceHistorySnapshot | null {
  if (payload.length > 65536) return null;
  try {
    const value: unknown = JSON.parse(payload);
    if (!value || typeof value !== 'object') return null;
    const snapshot = value as Record<string, unknown>;
    const layout = parseWorkspacePaneLayout(snapshot.layout);
    if (snapshot.version !== 1 || !layout || typeof snapshot.focused !== 'string' || !Array.isArray(snapshot.members)) return null;
    const cells = workspacePaneCells(layout);
    if (cells.length !== snapshot.members.length || cells.length < 1 || !cells.some(cell => cell.id === snapshot.focused)) return null;
    const ids = new Set<string>();
    for (const entry of snapshot.members) {
      if (!entry || typeof entry !== 'object') return null;
      const member = entry as Record<string, unknown>;
      if (typeof member.id !== 'string' || ids.has(member.id) || !cells.some(cell => cell.resourceId === member.id)
        || typeof member.title !== 'string' || member.title.length > 320 || typeof member.reference !== 'string' || member.reference.length > 8192
        || typeof member.kind !== 'string' || !kinds.has(member.kind) || typeof member.local !== 'boolean' || typeof member.ssh !== 'boolean'
        || !Number.isInteger(member.paneCount) || Number(member.paneCount) < 1 || Number(member.paneCount) > 4) return null;
      for (const field of ['cwd', 'connectionId', 'draftId', 'remoteId', 'paneId']) {
        if (member[field] !== undefined && (typeof member[field] !== 'string' || member[field].length > 4096)) return null;
      }
      if (member.shellType !== undefined && (typeof member.shellType !== 'string' || member.shellType.length > 64)) return null;
      if (member.empty !== undefined && typeof member.empty !== 'boolean') return null;
      if (member.kind === 'comparison' && (typeof member.scope !== 'string' || !scopes.has(member.scope))) return null;
      if (member.modes !== undefined && (!Array.isArray(member.modes) || member.modes.some(mode => mode !== 'block' && mode !== 'classic'))) return null;
      ids.add(member.id);
    }
    return { version: 1, layout, focused: snapshot.focused, members: snapshot.members as WorkspaceHistoryMember[] };
  } catch { return null; }
}

export function remapWorkspaceHistory(snapshot: WorkspaceHistorySnapshot, references: ReadonlyMap<string, string>): WorkspacePaneLayout {
  const visit = (node: WorkspacePaneLayout): WorkspacePaneLayout => {
    if (node.type === 'split') return { ...node, first: visit(node.first), second: visit(node.second) };
    const resourceId = references.get(node.resourceId);
    if (!resourceId) throw new Error('A workspace member could not be restored.');
    return { ...node, resourceId };
  };
  const layout = visit(snapshot.layout);
  if (!parseWorkspacePaneLayout(layout)) throw new Error('The restored workspace contains duplicate resources.');
  return layout;
}
