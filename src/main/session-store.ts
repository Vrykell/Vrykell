import { SessionInfo } from '../shared/types';

/**
 * Simple in-memory session store.
 * Phase 4 will add disk persistence to ~/.ai-terminal/sessions.json.
 */
export class SessionStore {
  private sessions = new Map<string, SessionInfo>();

  add(session: SessionInfo): void {
    this.sessions.set(session.id, session);
  }

  remove(id: string): void {
    this.sessions.delete(id);
  }

  get(id: string): SessionInfo | undefined {
    return this.sessions.get(id);
  }

  list(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  clear(): void {
    this.sessions.clear();
  }
}
