# Security model

> Readers: **read this page before adding any feature to Vrykell**, especially when integrating
> third-party code (MCP servers, skills, external harnesses) or adding a new IPC command.
> Companion documents: `security-review.md` (reviews and open items), `acp-harness-integration.md`
> (the external-harness design), `architecture.md` (layering).
> Last updated 2026-10-14.

## 1. Threat model: who can influence what

| Input source | Trust level | What it can reach |
| --- | --- | --- |
| The user (keyboard, panels, settings) | Authority | Everything (the terminal is arbitrary code execution — that is the product) |
| **Model output** (this app's agent) | **Untrusted content** | The rendering path (Markdown) and tool arguments (constrained by approvals and leases) |
| **Fetched pages, search snippets, skill text, MCP tool results** | **Untrusted content** | The same, and they are the **prompt-injection** entry point (content may say "send X to Y") |
| **Remote SSH hosts** | **Untrusted content** | Terminal output, remote file names; sessions are persisted and rendered again |
| **Third-party harnesses (ACP, planned)** | **A program the user adds** | Its own process rights (cannot be stopped); operations that come through the capabilities we advertised (can be stopped) |
| **A fully compromised renderer** | Worst case | Everything the UI can do — **including typing into the PTY** (§3) |

In one line: we protect "**untrusted content must not become a rendering-layer or execution-layer
instruction**", and "**dangerous operations require a confirmation the page cannot forge**". We do
not pretend to protect "the renderer itself" or "the programs the user installs".

## 2. The seven lines of defence (state, evidence, verification)

| Line | State | Evidence | How it is verified |
| --- | --- | --- | --- |
| No Node in the renderer | ✅ Tauri by construction; the renderer has no direct filesystem access, everything goes through IPC | `src-tauri/tauri.conf.json` | Structural |
| Explicit IPC with a capability list | ✅ Only `core:default` + dialog/drag/clipboard/opener + window controls; 171 own commands | `src-tauri/capabilities/default.json` | Changing the list means updating the docs |
| Per-command authorization (leases) | ✅ The four gated commands (`read_file_text`/`write_file_text`/`edit_file_text`/`fs_search`) must present a **single-use lease bound to the command plus an argument digest** or fail closed | `src-tauri/src/agent/permissions.rs` | The lease cases in `cargo test --lib` |
| Unforgeable confirmation for dangerous work | ✅ A hit on a dangerous command, a credential path or a durable write raises a **native system dialog**; an unfocused window is denied outright; approval cards have a deadline | the same file | cargo tests + e2e `approval-timeout` |
| Authorization granularity | ✅ Level table (allow/ask/deny) + **per-shape session approval** (`npm run` opens that kind only) + danger rules decided before any grant | the same file | cargo shape-derivation cases + e2e `approval-shape` |
| Path grants (arbitrary reads closed) | ✅ Commands that hand file *contents* to the page (attachment import) only accept a path an **operating-system gesture** produced: a grant registry in Rust (`files/grants.rs`, persisted to `~/.vrykell/approved-paths.json`); pickers run through our `pick_path` (only Rust opening the dialog knows the choice came from the user) and drops are recorded from `WindowEvent::DragDrop`; the app's own directories (attachments, skills) need no gesture; the unused `read_image_data_url` command is gone | `files/grants.rs`, `lib.rs` | cargo tests (granted file, granted directory, app-owned directory, everything else refused) |
| Rendering hygiene | ✅ Markdown enables no raw HTML, bare URLs are not linkified, remote images degrade to text, links never navigate the app window (they go to the system browser); terminal, command-block and SSH screen snapshots all pass through `sanitizeOutputHtml` (only `<span>` with safe styles plus `<br>`, under a threat model that includes "the local DB was tampered with") | `Markdown.tsx`, `sanitizeHtml.ts`, `TerminalPanel.tsx` | vitest (links, snapshot sanitizing) + e2e `chat-links` |
| CSP and resource scope | ✅ Production CSP: `default-src 'self'`, `script-src 'self'` (Tauri's own injected scripts are hash-allowed), `style-src 'self' 'unsafe-inline'` (React inline styles need it), `object-src 'none'`, `form-action 'none'`, `frame-ancestors 'none'`, images only self/data/asset, connect only ipc; the development exceptions (HMR websocket, inline scripts) live in `devCsp` only | `src-tauri/tauri.conf.json` | After `npm run build`, `dist/index.html` has no inline script; CSP changes need an app restart |
| Secrets and credentials | ✅ API keys and SSH passwords are encrypted at rest (DPAPI/keychain/0600), **model requests are proxied in Rust so the key never enters the renderer**, and attachment reads are confined to the attachments directory | `secret.rs`, `files/fs.rs` | Inspect `secrets.json`; `config.json` holds no key |

## 3. Two things that cannot be done, stated plainly

1. **Real isolation is out of reach**: the UI must drive the PTY (the terminal is the product), so a
   compromised renderer already means arbitrary command execution as the user. No IPC split and no
   "move the agent out of the webview" changes that. Our goal is therefore to **shrink what a
   compromise is worth**, not to prevent the compromise.
2. **"Caller identity" is currently empty**: the agent and the UI are both JavaScript in the same
   webview, so the backend cannot tell them apart. It is technically possible — Tauri injects the
   calling webview into a command signature and the page cannot forge it — but with a single webview
   it would buy nothing. When a second webview appears (an ACP harness session UI, for instance), do
   all three together: command namespaces, per-caller authorization, and leases bound to a
   `webview_label`.

## 4. Checklist for every new feature (each PR should answer these)

1. **New IPC command**: is it gated by a lease or policy? Is it in the gated-command list? Could it
   become a new "read/write/execute any path" entry point?
2. **New rendering path**: is something else being pushed into the DOM as `innerHTML`? Can it go
   through Markdown or text instead? If it must be HTML, does it pass `sanitizeOutputHtml`?
3. **New content source** (third-party text, files, endpoints): is it untrusted content? Is it
   sanitized before rendering? Could it invite an external-link click? (Links always go through
   `Link`, which hands web links to the system browser.)
4. **New capability or resource**: does the CSP need relaxing? Does the `assetProtocol` scope need to
   grow? Does the capability list need an entry? All three answers belong in the PR description.
5. **New third-party code** (process, script, plugin): is it added explicitly by the user? Does the
   settings copy say that adding it is the authorization?
6. **New authorization**: does it reuse the existing chain (level table, shape grants, deadlines,
   danger rules), or invent a second one? An invented one needs review.
7. **Logging**: does new logging leak command text, output or secrets? (Diagnostics record metadata
   only.)
8. **Tests**: does this line of defence have a unit or e2e test? (See the last column of §2.)

## 5. Known gaps and their cost (excerpt; the full table is in `security-review.md`)

| Gap | Cost |
| --- | --- |
| `opener`'s `open_path` scope is `**` (the file panel must be able to open any user file; by design, and no worse than the PTY) | — |
| Starting an external harness (`acp_handshake`) | A **documented class**, not a gap: it only starts a program the user **enabled** in `~/.vrykell/harnesses.json`, a probe **runs no tools** (every permission request is refused), and it does not widen the surface — the same webview can already run anything through the PTY. The phase-1 settings copy says that adding a harness is the authorization |
| Capability-based file access for the whole panel (paths must come from a user gesture or the shell's cwd) | 3–6 weeks, changes product semantics, still does not stop the PTY → not doing it |
| Moving the agent out of the webview | 2–4 months (Rust) / 2–4 weeks (sidecar), still does not stop the PTY → not doing it |

## 6. History

- Integration fixes, 2026-10-21: temporary tool and command-shape grants are scoped to conversation identity throughout approval, authorization and revocation. Requests without an identity cannot reuse grants, and revoking one conversation leaves others intact. Danger rules, native confirmation and single-use execution leases retain the existing authorization chain.
- ACP runtime connections use local IDs for isolation; remote session IDs are used only for protocol requests and resume records. Closing an established connection stops its process tree, I/O tasks and waiting requests; probes and failed opens also clean up. Configuration read failures do not return an empty list. Diagnostics record metadata without directories or raw protocol errors. Credential migration retains legacy values until all target writes succeed. This change adds no IPC commands, capabilities or CSP scope.
- `8ddffb1`: authorization decided in Rust, single-use leases
- `f3ca94f`: keys and passwords encrypted at rest
- `ab34159` / `5ee61b9`: danger rules (wrapper passthrough, Windows paths and shell family)
- `e026f96` / `e506d69`: approval deadlines and the bounds of the native confirmation
- `ee4c70e` / `0e83644`: per-shape session approvals
- Production CSP split, links that stay in the app, SSH screen sanitizing: see the matching entries in
  `security-review.md`
