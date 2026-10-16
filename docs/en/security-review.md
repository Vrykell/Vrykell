# Security Review

> Summary of successive security reviews of Vrykell (last updated 2026-10-16). Scope: backend Rust (Tauri commands, PTY, SSH/SFTP, SQLite, AI HTTP client, web scraping), frontend React (IPC calls, Markdown/HTML rendering, secret and configuration handling).
> Threat model: a local desktop application with no remote server; the main risk surfaces are "malicious remote endpoints (SSH/SFTP/AI/web content)", "malicious file names/paths", "secrets written to disk in plaintext", "command injection", and "intranet probing driven by LLM prompt injection (SSRF)".

---

## Fixed Security Issues

| Issue | Severity | Fix |
|---|---|---|
| `fs_rename`'s `new_name` could contain `/`/`..`, allowing a file to be moved out of its parent directory | High | Validated as a single path component |
| The SFTP directory download `download_dir_recursive` did not validate remote entry names; `..`/separator-containing names could path-traverse and escape the download directory | High | Reject names that are `.`/`..`/contain `/` `\` |
| SSH defaulted to `root` login when the username was empty | High | Changed to erroring with "Username must not be empty" |
| `which_cmd_sync` command probing injection | High | Retained a whitelist (alphanumeric + `-._+`) and switched to `/bin/sh` |
| AI API key written in plaintext to `~/.vrykell/config.json` with permissions not tightened | Medium | Keys moved out of `config.json` into the platform secret store alongside the SSH passwords (DPAPI-sealed on Windows, the system keychain on macOS, a 0600 file elsewhere); old plaintext is sealed by the startup sweep, the runtime reads only decryptable sealed values (unsealed or tampered values count as missing), and directory 0700 / file 0600 stays as defence in depth |
| `ai_stream` had no timeout (a hung network waits indefinitely) | Medium | Added `connect_timeout(15s)` + overall `timeout(180s)` |
| SSE multibyte characters truncated across chunks produced garbled text (not security, robustness) | Low | Byte buffering splits complete lines on `\n` before decoding |
| Wrong migration order caused a startup panic (`no such column: group_id`) | High (availability) | Index creation moved after the ALTER |
| **DNS alternating answers (rebinding) could bypass SSRF validation** | High | `PinnedResolver`: resolve once → validate → cache (TTL 60s), the connection reuses the validated result; an attacker cannot inject an intranet IP after validation |
| **IPv4-mapped IPv6 (`::ffff:127.0.0.1`) bypassed intranet blocking** | High | `is_private_ip` recursively judges mapped addresses by IPv4 semantics |
| **Proxy false positives/bypass**: proxy users were falsely blocked by local DNS; validation was skipped when NO_PROXY contained IP/CIDR entries; local resolution with socks5 was skipped | Medium | `proxy_does_remote_dns_for`: only remote-resolving proxies (http/https/socks4a/socks5h) skip DNS-level validation; validation is conservatively retained when NO_PROXY has IP/CIDR entries; socks4/socks5 are always validated |
| **Proxy not taking effect**: reqwest does not read environment-variable proxies by default | Medium | `env_system_proxy` builds Proxy::custom (HTTPS_PROXY/HTTP_PROXY/ALL_PROXY/NO_PROXY) |
| **Unbounded response body reads (memory DoS)**: web_fetch/crawl/search/registry/skills read the whole body via `text()/bytes()` | Medium | `read_body_capped` streams and truncates (web 10MB, SKILL.md 1MB, install files 2MB) |
| **Unchecked fetch redirects with no host restriction** (the skill marketplace's first hop was hardcoded, redirects could escape) | Medium | `is_github_host` whitelist; both the first hop and redirects are restricted to GitHub domains |
| **zip bomb: the size limit used values declared in the zip header (which can be falsified)** | Medium | Streaming decompression counts the bytes actually written and aborts when the limit is exceeded |
| **Concurrent writes to known_hosts overwrote each other** | Medium | The `verify_host_key` read-modify-write is serialized inside a process-level Mutex |
| **WebView had no CSP + the asset protocol scope was wide open (`$HOME/**`)** | High | Set CSP (script only self/inline, connect only ipc, img no remote sources, object/frame fully disabled); asset scope narrowed to `$APPDATA/**`, and wallpaper files are dynamically authorized via `allow_file` by the Rust side according to the user's selection |
| **markdown remote image exfiltration/tracking surface** | Low | Images are degraded to link text (remote images are not loaded), together with img-src having no remote sources |
| **The agent file tool could read secrets and leak them to the LLM (prompt injection)** | High | `sensitivePathReason` heuristic (.ssh/.aws/.env/config.json, etc.) → forces a per-invocation prompt regardless of the permission mode |
| **SSH hostname parameter injection (`-oProxyCommand`, etc.)** | Medium | `validate_ssh_host`: reject hosts starting with `-` / containing whitespace |
| **The SSH remote injection script could be tampered with → arbitrary code on the remote** | High | The injection script is a static constant inside the binary (not written to disk, not concatenated with remote data) and is passed as base64; `umask 077 + mktemp` creates a 0600 temporary file to prevent symlinks; tamper-resistance in transit relies on SSH encryption + OpenSSH host key TOFU confirmation; the fallback `exec "${SHELL:-sh}" -i` is quoted to prevent word splitting (a malicious `$SHELL` can only fail to connect, never execute); on injection failure it silently falls back to classic mode |
| **SSH passwords stored in plaintext in SQLite** | High | Passwords moved into the secret store (`secret.rs`: macOS Keychain / platform fallback 0600 file), leaving only a redacted marker in the database; plaintext in legacy databases is migrated automatically |
| **SSH first connection TOFU had no user confirmation** | High | The backend no longer records automatically: when unrecorded it returns `HOST_KEY_UNKNOWN:<fingerprint>`; the frontend form pops up a fingerprint confirmation, and only when the user chooses "Trust and continue" is known_hosts written (`ssh_trust_host_key`) |
| **`HistoryDb::open().expect()` startup panic** | Medium | On open failure it degrades to an in-memory database (history unavailable, the application keeps running) |
| **Migrations swallowed ALTER errors and hoped for the best** | Medium | `PRAGMA user_version` versioning + `ensure_column` per-column checks, so real migration failures report an error |
| Skill marketplace GitHub URL parsing (misjudging `/tree/main` and `.git` suffixes) | Low | Switched to standard parsing with the `url` crate, taking only owner/repo |
| **Remote rename/create accepted multi-component names** (`..` or separators could place files outside the target directory) | Medium | `platform::path::is_safe_component`: `ssh_rename`, `ssh_create_file` and `ssh_create_dir` now reject `.`, `..` and names containing `/` or `\`, matching the local guard (the download path was hardened earlier; this closes the command side) |
| **Fallback secret file written before tightening permissions** (a brief wide-permission window right after creation) | Low | The non-macOS fallback now creates the file with 0600 upfront and tightens `.vrykell` to 0700, keeping the post-write 0600 fix-up for existing files; macOS uses the keychain and is unaffected |

No high-severity XSS was found in the frontend: AI output is rendered through `react-markdown` (with `rehype-raw` not enabled), so raw HTML is escaped; the `dangerouslySetInnerHTML` in `BlockOutput` is used only to render HTML snapshots **generated by this application itself from the xterm buffer** (all cell text goes through `escapeHtml`), not external input.

---

## Still Unresolved (Requires Separate Evaluation, Higher Risk/Change)

| Issue | Severity | Description and Recommendation |
|---|---|---|
| In direct-connection mode, DNS pinning re-resolves after the TTL (300s) expires | Low (residual window) | Re-resolution on expiry validates again, so alternating answers can only cause "brief unavailability" rather than penetration. |
| In proxy mode, hostname intranet protection is delegated to the proxy | Low (by design) | Remote-resolving proxies take over domain resolution, which cannot be validated locally; this assumes trust in the user's own proxy. Literal private-network IPs are always blocked. |
| script-src contains 'unsafe-inline' | Low (dev compatibility) | Dev-mode Vite React refresh requires inline scripts; if dev support were dropped, it could be tightened to 'self' only. |

---

## Conclusion

This application is a local desktop tool with a limited attack surface that has been systematically hardened: SSRF (DNS pinning + proxy awareness + mapped IPv6 + response body limits + redirect whitelist), SSH (TOFU confirmation + password Keychain + known_hosts lock + parameter injection + single-component file names), WebView (CSP + narrowed asset scope + zero remote resources), Agent (mandatory prompts for sensitive paths + dangerous command heuristics + three permission tiers). There are currently no high-priority outstanding items.
