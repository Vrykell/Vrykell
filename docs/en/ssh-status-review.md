# SSH status and service authentication review

## Scope

Reviewed the SSH status sidebar, terminal status entries, connection log, resource collector,
SFTP recovery actions, temporary service authentication and their tests against `dev` at
`c531f84`. The branch retains the current chat, diagnostics, terminal I/O and file-property implementations from `dev`.

## Findings addressed

| Area | Finding and resolution |
| --- | --- |
| Authentication recovery | The terminal can fall back to a password while file/resource connections keep using a rejected saved key. Both panels now offer a shared authentication dialog, accepting a server password or a configured key's passphrase without changing the saved profile. |
| Credential isolation | Temporary credentials are bound to the saved profile ID, host, port, account, key path, jump host and authentication mode. The submitted address/account must still match the saved profile. Host-key verification runs before any credential is sent. |
| Credential lifetime | A successful authentication is required before caching. Profile save/deletion, explicit clearing, rejection and the last live terminal ending invalidate cached credentials. Request revisions prevent a late completion from restoring a cleared credential; late failures cannot discard a newer credential. Cache and pending-request counts are bounded. |
| Secret handling | Passwords and passphrases use explicitly redacted IPC fields, are cleared from the masked input on submission, and are absent from frontend state stores, profile writes and diagnostic payloads. Rust-owned temporary buffers use `zeroize`; credential objects have no `Debug` or `Serialize` implementation. |
| Connection log | Sessions without shell integration could previously retain ordinary shell output as connection history. Only recognized client notices and lifecycle signals are retained now. Text is redacted and bounded to 1,024 characters per line and 60 entries. |
| Retry behavior | Authentication failures stop automatic resource retries. Explicit refresh or successful shared authentication can resume collection; ordinary transport failures still use a delayed retry. |
| Remote execution | Resource commands are fixed scripts sent on a separate channel, with merged/drained output, a 16 KiB response limit and socket/session timeouts. No probe is written into the user's interactive terminal. Remote strings are rendered as text. Existing terminal snapshots continue through the escaped xterm buffer renderer. |
| Test discovery | Downloaded reference repositories were eligible for the default unit-test scan. Discovery is now restricted to project tests under `src/`. Reference files are excluded from the commit. |

No unresolved high-severity issue was found in the reviewed changes. This is a source and
regression review, not a guarantee about the server or the entire application.

## Verification

TypeScript checking and the architecture guard passed. The complete frontend unit run plus
the four import-affected suites rerun after conflict resolution passed 1,379 tests, with one
existing skip. Rust library tests passed 177 tests with three opt-in/manual checks ignored;
the final remote-only check passed 17 tests. All 50 SSH/workspace Playwright scenarios passed
across the main run and the initial compile-affected scenario rerun. An earlier sidebar run
also passed all 24 scenarios. Browser checks include
masked input, wrong-password recovery, shared file/resource recovery, cancel/focus behavior,
explicit clearing, terminal isolation, light/dark themes, width resizing and narrow layouts.
The restricted diagnostic key copy was deleted with explicit user authorization; original keys
and saved connection credentials were left intact.

## Operational limits

- The terminal still runs an independent SSH client. Its password input is never intercepted;
  after a terminal password fallback, the services request explicit authentication once.
- Temporary credentials survive in backend memory only during this application run. Clearing
  the cache does not revoke a network operation that already obtained its credential reference.
  JavaScript/native transport copies are transient and are not covered by the Rust buffer-wipe guarantee.
- Jump-host file/resource access and arbitrary multi-factor keyboard challenges remain outside
  this change. A password cannot enable SFTP when the server has disabled that subsystem.
- Automated browser tests mock the SSH transport. Final acceptance against a user's server
  requires entering the working credential in the application; no real password belongs in test fixtures.
