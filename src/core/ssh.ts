/** Non-secret options shared by saved connections and terminal launch requests. */
export interface SshOptions {
  identityFile?: string;
  jumpHost?: string;
  serverAliveInterval?: number;
  shellIntegration?: boolean;
  /**
   * How the spawned ssh client verifies the host key.
   * - `strict` (default): only already trusted hosts are accepted; Vrykell confirmed the key first.
   * - `ask`: the client asks inside the terminal when the fingerprint is unknown. Used when the
   *   preflight cannot run, so a working ssh is never blocked by the inspector.
   */
  hostKeyPolicy?: 'strict' | 'ask';
}
