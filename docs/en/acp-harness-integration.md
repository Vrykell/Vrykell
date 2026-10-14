# Connecting external harnesses (Agent Client Protocol)

> Status: **design (not implemented)**. Protocol basis: Agent Client Protocol **v1**
> (agentclientprotocol.com), checked against the official specification in 2026-10 for method
> names, capability fields and message shapes.
> Readers: whoever implements this, plus reviewers who need the boundaries and the trade-offs.

## 1. Goals

Vrykell acts as an **ACP client (host)** and brings external agent harnesses — Claude Code, Codex,
OpenCode, Gemini CLI, anything that speaks ACP — into the workspace:

1. **One harness session = one workspace tab**: transcript, tool cards, approval cards and the stop
   button all reuse the existing components; no second chat surface is invented.
2. **Approvals and grants stay ours**: the per-shape session approval, the approval deadline and the
   native confirmation for dangerous commands keep applying; the harness does not decide safety.
3. **The usage page records harnesses as a new `source`** (with one trade-off that has to be
   accepted — §6).

## 2. Non-goals (first version)

- No ACP **server**: Vrykell's own agent is not exposed to other editors.
- No `elicitation/*` (form/URL interaction) and no `compaction_*` (context-compaction visuals): the
  capabilities are simply not advertised, and the spec requires harnesses to respect that.
- No MCP passthrough: `session/new` sends an empty `mcpServers` array first.
- No process pooling: one process per harness definition, several sessions inside it.

## 3. Protocol essentials (v1, verified)

Transport: subprocess stdio, **one JSON-RPC 2.0 message per line** (the same shape the existing
`agent/mcp.rs` client uses); parameters are camelCase, discriminator values snake_case; every path
in the protocol must be absolute.

Client → agent (what we implement):

| Method | Purpose |
| --- | --- |
| `initialize` | Version (`protocolVersion: 1`), capability negotiation, implementation info |
| `session/new` | `{cwd, mcpServers: []}` → `{sessionId}` |
| `session/prompt` | `{sessionId, prompt: ContentBlock[]}` → `{stopReason}`: `end_turn` / `max_tokens` / `max_turn_requests` / `refusal` / `cancelled` |
| `session/cancel` (notification) | Interrupt the current turn, no response |
| `session/load` · `session/resume` · `session/close` | Restore or close sessions (the agent must advertise `loadSession` / `sessionCapabilities.*`) |
| `session/set_mode` | Switch the agent's operating mode (display-only in the first version) |

Agent → client (what we handle):

| Method | Purpose |
| --- | --- |
| `session/update` (notification) | `user_message_chunk` / `agent_message_chunk` / `agent_thought_chunk` / `tool_call` / `tool_call_update` / `plan` / `available_commands_update` / `current_mode_update` / `session_info_update` / `usage_update` / `notice` |
| `session/request_permission` | `{sessionId, toolCall, options[]}`; options carry `kind`: `allow_once` / `allow_always` / `reject_once` / `reject_always`; we answer `{outcome:{outcome:'selected', optionId}}` or `{outcome:{outcome:'cancelled'}}` |
| `fs/read_text_file` · `fs/write_text_file` | Only called when we advertised the `fs` capability |

The `tool_call` shape (this decides how the tool card is reused): `toolCallId`, `title`, optional
`name`, `kind` (`read`/`edit`/`delete`/`move`/`search`/`execute`/`think`/`fetch`/`switch_mode`/
`other`), `status` (`pending`/`in_progress`/`completed`/`failed`), `content[]` (`content` /
`diff{path,oldText,newText}` / `terminal{terminalId}`), `locations[]`, `rawInput`, `rawOutput`.

The client capabilities we advertise (proposed):

```json
{
  "protocolVersion": 1,
  "clientCapabilities": {
    "fs": { "readTextFile": true, "writeTextFile": true },
    "terminal": false,
    "session": { "notices": {} }
  },
  "clientInfo": { "name": "vrykell", "title": "Vrykell", "version": "<package version>" }
}
```

- `fs`, reads **and** writes: this is what puts harness file access *through us*, where it can be
  reviewed, blocked and logged (§5). Not advertising it does not stop a harness from writing files
  itself; it only moves that out of our sight.
- `terminal: false`: the first version does not lend the harness a terminal (it runs commands its own
  way). The cost is in §8; P4 advertises it and pulls command execution into our danger rules and PTY.
- `session.notices` is cheap and useful (MCP going away, for instance); `session.compaction` is not
  advertised.

## 4. Architecture

```
user input (workspace harness tab)
  → Tauri command surface (acp_*)
    → Rust `agent/acp.rs`: subprocess + ndjson JSON-RPC (request correlation, notification fan-out,
      cancellation)
      ↑ session/update, session/request_permission
      ↓ initialize / session/new / session/prompt / session/cancel
        harness subprocess
  ← Tauri events → frontend `useAcpSession` store
    → mapped onto the existing ChatMessage / ToolRun (AiBlock, ToolRunCard, approval card)
```

- **Protocol and process live in Rust**, matching the existing "the backend decides" stance (the MCP
  client is there too); the frontend never touches stdio.
- **The frontend only maps**: `tool_call.kind` picks the icon (`execute` → terminal, `edit`/`delete`
  → pencil, `read` → file, `search` → search, `other` → wrench); `kind: 'think'` uses the thinking
  disclosure; `diff` content is shown as text in the first version.
- **Session identity**: the pair `(harnessId, sessionId)`. The workspace tab kind is `harness`; the
  title comes from `session_info_update`, falling back to the first user message.
- **Process lifetime**: spawned when a session for that harness is first opened (`kill_on_drop` plus
  the existing `terminate_tree` for the child tree); a process that exits marks its sessions
  disconnected; when the agent advertises `loadSession`, a "reconnect and replay" action is offered.

## 5. Permissions and approvals (the core)

The `session/request_permission` decision is **ours** (the spec explicitly allows a client to allow
or reject automatically according to its user settings). The mapping:

| option `kind` from the agent | what we show and do |
| --- | --- |
| `allow_once` | "Allow once" → answer with that `optionId` |
| `allow_always` | "Allow `<shape>` this conversation" → derive the command shape from `toolCall.rawInput` (reusing `command_shape` in `agent/permissions.rs`) and grant **that shape only**; with no derivable shape, fall back to the whole-tool session approval; with neither, answer `allow_once` |
| `reject_once` | "Deny" |
| `reject_always` | Treated as a denial, remembered for the session (we do not hand the harness a long-lived rule we cannot revoke) |

- **Dangerous commands still go through the native confirmation**: the command text in
  `toolCall.rawInput` is fed to the existing `danger_reason` / `sensitive_path_reason`, and a hit
  raises the native dialog exactly as for the local agent, whatever options the harness offered.
- **`fs/write_text_file` is not an approval by itself**: it takes the same path as the local
  `write_file` tool — level table, danger and credential checks, approval card — before anything
  lands on disk; `fs/read_text_file` is confined to the session's root set (`cwd` plus
  `additionalDirectories`).
- **Cancellation**: after sending `session/cancel`, every pending permission request must be answered
  with `{outcome:'cancelled'}` (the same semantics as `denyAllPending`); an approval that hits its
  deadline answers `reject_once` and explains itself in the transcript (the P1 behaviour, unchanged).
- `session/set_mode` and the modes an agent advertises are display-only in the first version.

## 6. Usage accounting (a trade-off that must be accepted)

ACP v1 offers only **`usage_update`**: session context `used`/`size` in tokens, plus an optional
`cost{amount,currency}`. There are **no** per-turn input/output/cache token counts.

So a harness source **cannot** be shown with the local agent's metrics — total tokens, fresh input,
cache hit rate — because those come from the provider's per-turn report and ACP does not carry them.

The proposal: a harness source shows **session context usage**, and the reported `cost` is **not
displayed** even when present (the usage page deliberately shows no money — plan pricing makes a
figure look authoritative when it is not); it stays in the data model for a possible opt-in later.
The card should say that this source only reports context usage. The `source` chips are already in
place, so the harness name simply becomes its `source`. If a harness later reports finer per-turn
token counts through `_meta`, we can pick them up (`_meta.vrykell` is our extension slot).

## 7. Workspace and settings

- A new tab kind `harness`; entry points: the new-tab menu ("Connect a harness…") and global search
  ("harness"); the icon comes from the harness definition, defaulting to a bot glyph.
- Inside a session: the stop button sends `session/cancel`; `plan` updates render as a collapsible
  row above the tool cards (reusing the thinking disclosure); `notice` updates raise a toast.
- A new settings group, "External harnesses" (after "Subagents"): name, command, arguments (one per
  line), environment variables, working-directory policy, enabled. Persisted to
  `~/.vrykell/harnesses.json` in the same shape as `mcp.json` (single file, camelCase, editable by
  hand).
- Each harness gets a "Test connection" action that only runs `initialize` and reports the negotiated
  protocol version and capabilities — the one place in the first version that really starts a
  process, and the way to validate a configuration.

## 8. Security boundary (stated plainly)

What we can constrain:

- operations that come through **the client capabilities we advertised** (`fs/*`, later
  `terminal/*`): our policy, approvals and logs;
- our own process management: working directory, environment, child-tree cleanup on exit;
- capabilities we refuse really are refused (the spec requires harnesses to honour `initialize`).

What we **cannot** constrain (and what belongs in the docs and the settings copy):

- a harness reading and writing files or running commands with its own process rights — it is a local
  process, no different from a command typed into our terminal, which is why an external harness is a
  **program the user explicitly adds**: adding it is the authorization;
- the model and tool decisions inside the harness: we only see the `session/update`s it chooses to
  send.

In short, the model is **"a program the user added" plus "everything routed through us is visible and
blockable"** — not a sandbox.

## 9. Phases

| Phase | Content | Verification |
| --- | --- | --- |
| **P0 protocol** | `agent/acp.rs`: ndjson codec, request correlation, notification fan-out, cancellation, `initialize` / `session/new` / `session/prompt` / `session/cancel` / permission answers; harness config plus the `acp_handshake` probe | cargo tests: an in-memory transport (`tokio::io::duplex`) driving a scripted fake agent, covering the handshake, one prompt turn, the notification stream, a permission request and the cancel path |
| **P1 visible** | workspace harness tab, settings group, event → ChatMessage/ToolRun mapping, stop | vitest (mapping and store) and an e2e with a fake agent (open a tab, send a turn, watch the stream, press stop) |
| **P2 safety** | permission → approval card (shape grant, deadline), `fs/*` through the policy, native confirmation for dangerous commands | cargo (policy reuse), vitest (permission mapping), e2e (dangerous command asks natively, an unanswered card is denied) |
| **P3 experience** | `session/load` restore, display-only modes, notices/plans, context-usage bar, usage-page `source` | unit tests per layer plus e2e |
| **P4 optional** | `terminal/*` delegation (commands through our PTY, full danger-rule coverage), MCP passthrough, elicitation | as needed |

## 10. Open decisions

1. Advertise `fs.writeTextFile` in the first version? (Recommendation: yes — §3/§5.)
2. Advertise `terminal` in the first version? (Recommendation: not yet; the cost is not seeing the
   harness's commands.)
3. Is the usage stance acceptable — a harness source showing context usage and cost only?
4. A separate `~/.vrykell/harnesses.json`, or folded into `config.json`?
5. Are the entry points (new tab plus global search) and the settings group placement right?
