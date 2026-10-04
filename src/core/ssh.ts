/** Non-secret options shared by saved connections and terminal launch requests. */
export interface SshOptions {
  identityFile?: string;
  jumpHost?: string;
  serverAliveInterval?: number;
  shellIntegration?: boolean;
}
