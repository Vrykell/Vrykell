# UX Contract

Main, split and sidebar conversations run independently. Inputs queue only behind a turn in the same conversation; stopping or completing one owner cannot release another owner's busy state. Background schedules begin while idle but do not block later interactive work. Model connections retry twice with abortable backoff before any response begins; authentication and configuration failures are immediate, and partial responses are never replayed.

Questions stay inside the owning transcript with choices, free text and skip. Restored questions are inert. Split actions retain their workspace and share one layout engine; removing placement is available only for multiple panes. Creation dropdowns retain a trigger snapshot after parent menus close, and toolbar action containers reserve non-overlapping intrinsic width. Agent startup exposes the project directory before connecting. Conversation settings are a persistent non-modal panel: changing an option or choosing a new execution profile does not close it, and Escape closes the child first.

## Product Context

Sidebar conversations share the original title header and action order across backends. Agent selection and execution settings belong to the sliders panel. Users may queue inputs during a reply; each queued item can be removed and the next input starts only after the current turn ends. Stop immediately releases the conversation and clears its queue, pending questions and approvals. An unresponsive external session is detached after a bounded cancellation window and the next input resumes its saved session. Late callbacks cannot modify a newer turn. Empty terminal sessions and conversations remain transient until meaningful content exists; an entirely empty composition is not saved. Terminal disconnection returns an explicit tool result requiring user action rather than silently selecting another target.

External sessions use the same application tool implementations and approval cards as native conversations. The execution target is explicitly selected, fixed during a turn and never inferred from workspace focus. Questions do not grant execution permission. Stopping disables execution and cancels pending interactions; closing revokes the session bridge.

Workspace panes never add a second tool row: the focused conversation contributes its controls to the existing instance strip. Split creation choices appear directly when they would otherwise be the only submenu entry.

Creation actions use at most two menu levels. Terminal profiles, saved hosts and agents open their existing launch pickers after closing all parent menus, anchored to the original toolbar button. Agent startup retains search, availability and project-folder selection rather than reducing the launcher to a plain menu. Editor splits offer both new and existing files, and resource creation waits for placement. Non-terminal panes share a right-click menu for splitting and removing placement; last-pane removal stays hidden and removing a pane never bypasses the resource owner's guarded close.

Desktop terminal, remote-host, file and conversation workflows use the existing English/Chinese locale provider. Localized dates follow the user's environment. Accessibility targets include keyboard operation, visible focus, semantic names and stable geometry. The visual contract is `DESIGN.md`; runtime tokens remain canonical.

## Business-Context Sources

| Scope | Source | Consequence |
|---|---|---|
| Permissions and credentials | `docs/en/security-model.md` | Preserve backend grants, host-key verification and credential boundaries |
| Session and document lifecycle | `docs/en/feature-spec.md` | Presentation changes do not restart processes or discard drafts |
| Shared controls and implementation rules | `docs/en/development-rules.md` | Extend common owners rather than local substitutes |
| Host and menu presentation | Current user prototypes, 2026-10-24 | Compact controls, one-line lists, neutral card selection and blue primary actions |
| Usage navigation | Current user request, 2026-10-24 | Left model chips replace source chips and the duplicate model dropdown |
| Billing/legal actions | Not applicable | Usage reports display measurements; this interface does not transact |

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Select/Listbox | `src/ui/fields/Select.tsx` | Development rules | Authored popup | Shared unit and browser keyboard/collision tests |
| Form | `TextInput`, `TextArea`, `SegmentedControl`, `TagInput` | Development rules | Connection, settings, text editing | Owning unit and browser flow tests |
| Scrollbar | `src/app/theme.css`, `OverlayScrollbar` | Shared runtime CSS | Terminal geometry exceptions | Browser overflow and scrollbar tests |
| Toast | `src/ui/feedback/Toast.tsx` | Development rules | Success, info, error | Owning action tests |
| CRUD | Owning domain services and workspace navigation | Feature specification and security model | Host return-to-list; editor stay-on-document | Domain unit and browser flow tests |
| Error | `ErrorBox`, `ErrorDetails`, `NotificationPortal`; domain `HostResources` owns status data | Current notification request and development rules | Persistent bottom-right errors; inline informational status; full-page global fallback | Shared unit, modal keyboard and retry browser tests |
| Dialog | `ToolDialog`, `ConfirmDialog`, `useDialogKeyboard` | Development rules | Modal editing/confirmation | Focus, Escape, cancellation tests |

## Workflow and State

- Save preserves inputs on failure, prevents duplicate dispatch and exposes a persistent notification with a retry path. Host save returns to its list; text save remains in the document.
- New text buffers are in memory until a destination is selected. Save As uses the platform picker and backend access grants. Existing-file conflicts must not silently overwrite changes.
- Closing dirty text prompts Save, Discard or Cancel. Cancel retains the same buffer; discard does not save it. Navigation, tab order and terminal splits do not discard state.
- Host deletion and forwarding-rule deletion use app-owned confirmation. Start and stop reflect real backend state and retain an honest retry path.
- Port forwarding is a child page of host management, reached through its header and a return breadcrumb. Its content matches the host page width. Automatic startup is an explicit per-rule choice; independently running forwarding stays visible until stopped or the app exits.
- When collecting resources, host tables expose status independently of CPU, memory and disk. Metric headings align with track starts; missing dashes center under the heading text, with compact bar/value spacing. Card tracks follow the shorter, thicker reference proportions. Hover reveals the address; Space opens keyboard-accessible details. Disabling collection restores name, address, tags and recent-connection columns. The text-only context menu connects, edits, duplicates, favorites, copies the address, retries, disables collection per host and deletes with confirmation; it has no details entry. Duplicates never inherit credentials or automatic forwarding listeners. Failed cards omit recent connection time.
- Resource failures remain in their card or status cell. Read failures retain the last sample and timestamp; authentication failures offer credential retry; offline states do not pretend to have measurements. Empty measurements render only a dash.
- Host lists retain manual drag order through the shared reorder controls. Dragging switches to the explicit manual-order preference; name, recent-connection and resource sorting remain separate choices. Reloading preserves the saved manual sequence without changing connection data.
- Encoding changes either reopen the original bytes after unsaved-change confirmation or save using strict encoding without replacement characters. Markdown preview preserves the document model. Find and replace float over the editor without moving its content.
- File browsers restore only their last directory across launches, separately for the local browser and each remote connection; navigation trails remain transient. Directory synchronization shortcuts call the same validated actions as the menu. The shared editor preferences page owns modal bindings, wrapping, line numbers and independent typography. Local and remote opening pages retain their own opening destination and command mappings.
- Tab arbitration gives built-in suggestions first priority, shell candidates second and paths through the terminal's file channel last. A chosen provider owns the whole cycle. Shell queries use bounded child processes with constant scripts and data-only input; no query is submitted to the live terminal. Remote panes retain remote path completion without querying a local shell. It preserves quoting and command suffixes, cycles candidates with Tab or Shift+Tab and restores the prefix with Escape. Late responses never replace an edited draft or a changed terminal context; completing a path never executes it.
- Model chips filter reported token usage across sources. Provider and time remain right-side filters. Session-only agent reports remain in the ACP details table and are never invented as per-model token counts.

## Navigation and Feedback

Main and split AI conversation content has no separate heading or toolbar. Conversation actions stay in the shared tab toolbar when the sidebar opens, closes or changes its selection.

The leading slot in terminal, code, AI and common strips opens all workspace tabs. Resource switching and splitting do not occupy additional right-toolbar slots. Split tab is a context submenu of creatable types, retaining full profile, host and agent pickers and creation after placement. Removed project-selection and open-in-terminal toolbar actions remain in domain context menus. The common toolbar offers side docking for the focused AI owner; insufficient space preserves its main placement. Sent attachment cards follow their question, close previews on outside press or Escape and restore chip focus on Escape. Pure chat sends images to image-capable models and explicitly rejects unsupported image input. Find/replace keeps the close control in the upper row.

Startup restores terminal owners from validated saved placements instead of leftover active records. It filters old untouched inactive default empty conversation placements without deleting history, protecting selected, named, grouped, shared and nonempty drafts. Sidebar-only AI sessions do not hide the start tab.

Common-workspace tabs own complete reference layouts in the existing tab store. New creates a tab; Split adds a pane inside that tab. Move to new tab and explicit Merge retain content owners. Zoom restores the unchanged layout. Close pane closes that resource through its domain guard; close tab checks every member before closing any. Start appears only when no content tab exists. History restores keep their explicit destination and open a composition tab rather than overwriting an unrelated active layout. One tab retains its history identity while membership changes. Missing members leave the active layout intact. Forgetting history removes metadata only. See `docs/en/workspace-compositions.md` for ownership boundaries.

The AI side panel switches native and external conversations independently from main navigation. Opening it restores its own selection or creates a separate draft; it never borrows a resource assigned to the main workspace or split layouts. Main and sidebar content can remain visible together. Only explicit movement transfers a mounted owner and its draft. Agent creation reuses the existing project-folder launcher and application-tool adapter. External thoughts, tool events and text form one answer per user turn, with one completion footer. Live replies keep that footer hidden until the turn finishes. Transcript status strips are absent; execution and directory context remain in existing selectors and tooltips.

Provider creation accepts a custom name, API family, HTTP endpoint, model identifier and optional key. Changing an endpoint preserves configured credentials through the native secret store; moving to a different origin requires explicit confirmation before reusing a key. Selected models retain the normal font weight. Recognized model families use shared marks; unidentified aliases are never assigned an invented vendor.

Choosing a provider also selects a model from that provider for subsequent chat requests. A newly added custom provider activates its requested model, matching preset creation. Keys remain isolated by API family and effective endpoint; a successful check never authorizes borrowing another provider's secret.

When a previously selected configuration differs from the current chat provider, the explicit Check and use action validates and activates it. A late check cannot override a provider or model selected while the request was pending. Menu labels align left without a leading empty mark column; selection marks align right.

Inline rename fields outside tab cards use the shared field at a fixed 176 px target or the available parent width, with an eight-pixel gap before actions. Typing does not move adjacent actions; sidebar actions stay at the far right. The sidebar conversation settings offer recent sessions without losing each session's draft. Modal command entry occupies the existing 32 px single-line editor status bar with a centered 28 px input, replacing secondary metadata only while typing; it does not add a row or retain execution results. Filenames have no trailing marker; an unsaved draft uses a separate text label. Narrow status bars hide secondary metadata. Copy operators also update the system clipboard, except the explicit discard register.

Workspace state is local rather than URL-based because it represents desktop sessions, local paths and private connection identities. Host sort/layout preferences persist locally; page scrollers and document models retain their owners. Host filtering is local, usage logs use explicit pagination, and no extra network search is introduced.

Menus close on outside press or Escape and restore their trigger focus. They clamp to the visible viewport; long menus scroll. A non-modal creation dropdown does not claim a modal focus trap. Full forms keep actions reachable within their page scroller.

Terminal paste retains its original foreground owner through asynchronous reads, confirmation and queued writes. Command/prompt or alternate-screen transitions invalidate its native epoch before output batching, cancel unsent chunks and show an informational toast; cancelled text is never replayed into another prompt or composer. Native writes recheck after locking and between bounded partial writes, with newline keys separate from text. Already accepted system terminal bytes remain outside cancellation's guarantee, as recorded in the security model.

Terminal and external-session creation reuse `AnchoredDropdown`, including its measured placement, 304 px width, bounded scrolling, transparent outside-dismiss surface and focus restoration. Opening settings dismisses ephemeral launchers. A full-width sidebar row opens the common workspace; the all-workspace dropdown only switches existing tabs. Existing domain stores remain authoritative for tab activation, reordering, saving and guarded closure. The common strip projects their resource references rather than copying live tab models. Its right-hand toolbar receives the focused resource's existing tools; no extra toolbar or pane caption is added. Terminal and common workspaces share the same split renderer, pane surface, divider, placement geometry and hover picker. Editor and external-session split controls enter that shared path; the side-docking action has a distinct side-panel icon. New resources are created only after placement, and external sessions get separate owners. The common start page reuses existing launcher components. Up to four mixed panes move existing hosts through `ResourceContent` without recreating resources; explicit conversation execution targets and independent drafts remain intact. Pane removal changes placement only. Preferences contain validated references and geometry, never content, credentials or executable data. Missing references fall back safely, and narrow horizontal splits stack.

History uses native keyset pages of 40 metadata records, without loading transcripts. Scrolling or Load more appends a page. Search waits for composition completion, debounces queries and progressively scans sparse matches with frame yields. Group metadata is reused across filters. Counts describe loaded records until the source is exhausted; explicit batch operations gather the full matching scope. Failed appends preserve the retry cursor; stale responses cannot replace newer results. Diagnostics separate lock wait from query time without recording history payloads. The AI start page always exposes history. Native history uses the application mark; external sessions retain their shared agent marks.

Read failures use persistent bottom-right `ErrorBox` notifications with useful guidance, diagnostic details, dismissal and retry. Ordinary transient outcomes use `Toast` in the same shared notification region. Notifications track the visibility and lifetime of their owner, and an active modal includes its own notification controls in keyboard navigation. The global error page remains full-page. Long diagnostics wrap or scroll without squeezing action buttons. All visible copy and accessible labels use the locale catalog.

Tool cards retain result statuses without footer errors. Live execution failures and explicit result review use the same bottom-right ErrorBox. Restored history and approval outcomes never automatically replay notifications. Refusal shares the failed badge appearance; a cancelled question remains cancellation rather than failure.

Answered question cards retain only the chosen option or typed answer as selectable plain text with consistent left and right insets. Other choices and selection highlighting disappear after answering and remain absent when history is restored.

## Verification

The strict static audit retains the baseline heuristic findings: shared `Select` usages classified as native selects, plus existing form, wrapper and terminal-scrollbar findings. The custom-provider choice uses the canonical authored `Select`; no native select was introduced. These findings remain explicitly unresolved by the checker, not a passing audit result. Runtime verification covers notification retry and modal focus, actual menu alignment, compact creation pickers, cross-domain resource switching, dark/light dialogs, narrow editor commands and fixed rename geometry.

Run typechecking, owning unit tests, architecture boundaries and interactive browser regressions. Review narrow and wide layouts, both themes, actual display scaling, long diagnostics, empty and failure states. The project feature specification records domain-specific coverage; static design audits do not substitute for runtime evidence.
