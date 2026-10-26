# Application tools for external sessions

External sessions receive a session-owned standard-input/output tool server through existing session creation and loading requests. It adapts the same tool implementations used by native conversations, not another execution or permission engine.

The initial allowlist contains command execution, terminal reading and keys, file reading/writing/editing, directory listing, file search and user questions. Denied tools are not advertised. Terminal access starts unbound: users select a target in the existing composer status row. A turn captures that target; changing workspace focus cannot redirect it. Target changes are disabled during a turn, rotate the authorization identity and clear previous session grants, so delayed cleanup cannot reuse grants on a different target. Remote targets cannot use local file tools.

Questions and approvals reuse transcript cards. Calls are serialized within one turn. Refusal blocks all further tools, including questions; the agent explains the result and waits for a new user message. At most one question can open per turn, including paraphrased attempts. Answering supplies context without granting execution approval. Stopping cancels questions and approval waits. Backend policy, native confirmations and single-use execution leases remain authoritative.

The application helper starts before window creation and single-instance handling. It relays bounded protocol frames to an ephemeral loopback socket, authenticated with a random session token supplied only in its environment. No token enters command arguments, saved configuration or diagnostics. This is not an HTTP or public service; browser requests cannot satisfy its framed authentication handshake.

Each session owns its listener, token, pending requests and active-turn generation. Initialization and history replay cannot execute tools. Results resolve only outstanding requests in the same live connection. Closing releases the listener and helper connections. Delivery failures, closed sessions and expired requests fail closed. Only the main window can answer results.

Credentials, arbitrary application IPC, outward tool-server chaining, scheduling, installation and subagent creation are excluded. External agents can still have independently configured tools; this adapter does not sandbox those processes. Existing protocol and client filesystem/terminal capability flags remain unchanged.

Native tests cover transport authentication, catalog validation, inactive turns, result correlation, cancellation, stale generations and frame limits. Unit and browser tests cover validation, fixed targets, refusal, questions and transcript ownership. The optional process test uses a built development executable through `APP_TEST_MCP_HELPER_EXE` to verify protocol-only output and shutdown without a window.
