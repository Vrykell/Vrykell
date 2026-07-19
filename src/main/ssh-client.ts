import { EventEmitter } from 'events';
import { SSHConnectOptions, SessionInfo } from '../shared/types';

/**
 * SSH client stub. Phase 4 will implement with ssh2.
 */
export class SSHClient extends EventEmitter {
  private counter = 0;

  async connect(opts: SSHConnectOptions): Promise<SessionInfo> {
    // Phase 4: Implement real SSH connection with ssh2
    const id = `ssh-${++this.counter}-${Date.now()}`;
    const session: SessionInfo = {
      id,
      type: 'ssh',
      title: `${opts.username}@${opts.host}`,
      host: opts.host,
      username: opts.username,
      cols: 80,
      rows: 24,
      createdAt: Date.now(),
    };

    this.emit('connected', session);
    return session;
  }
}
