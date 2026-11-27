import type { TermBlock } from './pipeline/termBlock';
import type { PaneInput } from '../stores/input';

export interface TerminalHandoff {
  paneId: string;
  sessionId: string;
  inputEpoch: number;
  cwd?: string;
  shell?: string;
  draft?: PaneInput;
  blocks: TermBlock[];
}

interface TerminalAdoption extends TerminalHandoff {
  ready: () => void;
}

interface TerminalOwner {
  read: () => Omit<TerminalHandoff, 'inputEpoch'> | null;
  release: (sessionId: string) => void;
}
const owners = new Map<string, TerminalOwner>();
const incoming = new Map<string, TerminalAdoption>();

export function registerTerminalHandoff(paneId: string, owner: TerminalOwner) {
  owners.set(paneId, owner);
  return () => {
    if (owners.get(paneId) === owner) owners.delete(paneId);
  };
}

export function readTerminalHandoff(paneId: string) {
  return owners.get(paneId)?.read() ?? null;
}

export function releaseTerminalHandoff(paneId: string, sessionId: string): void {
  owners.get(paneId)?.release(sessionId);
}

/** The receiving renderer must have installed its PTY listeners before the old owner can move it. */
export function stageTerminalHandoffs(panes: TerminalHandoff[]) {
  return Promise.all(
    panes.map(
      (pane) =>
        new Promise<void>((resolve) => {
          incoming.set(pane.paneId, { ...pane, ready: resolve });
        }),
    ),
  );
}

export const incomingTerminalHandoff = (paneId: string) => incoming.get(paneId);

export function discardTerminalHandoffs(panes: readonly TerminalHandoff[]) {
  for (const pane of panes) {
    const adoption = incoming.get(pane.paneId);
    if (adoption?.sessionId === pane.sessionId) {
      incoming.delete(pane.paneId);
      adoption.ready();
    }
  }
}
