/** One real connection line or signal, in arrival order. */
export interface SshLogEntry {
  time: number;
  text: string;
}

export interface SshSessionStatus {
  phase: 'connecting' | 'connected' | 'interactive' | 'authenticating' | 'disconnected' | 'unavailable';
  reconnectAttempt: number;
  retrying: boolean;
  /** Real client output and connection signals, oldest first. */
  log: SshLogEntry[];
}

/** Address displayed when services request temporary credentials. */
export interface SshAuthenticationTarget {
  connectionId: string;
  host: string;
  port?: number;
  user?: string;
  identityFile?: string;
}

/** Non-secret options shared by saved connections and terminal launch requests. */
export interface SshOptions {
  identityFile?: string;
  jumpHost?: string;
  serverAliveInterval?: number;
  shellIntegration?: boolean;
  /** `-L` specifications, e.g. `8080:localhost:80`. */
  localForwards?: string[];
  /** `-R` specifications, forwarded from the remote side. */
  remoteForwards?: string[];
  /** `-D` specifications: a local SOCKS port, e.g. `1080`. */
  dynamicForwards?: string[];
  /** Reconnect automatically after an unexpected drop. A clean remote exit is left alone. */
  autoReconnect?: boolean;
  /**
   * How the spawned ssh client verifies the host key.
   * - `strict` (default): only already trusted hosts are accepted; Vrykell confirmed the key first.
   * - `ask`: the client asks inside the terminal when the fingerprint is unknown. Used when the
   *   preflight cannot run, so a working ssh is never blocked by the inspector.
   */
  hostKeyPolicy?: 'strict' | 'ask';
}
