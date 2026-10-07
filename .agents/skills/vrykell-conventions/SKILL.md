---
name: vrykell-conventions
description: Vrykell project conventions and definition of done for any code, test or docs change in this repository - constraints, commands, shared components, testing and commit rules. Use whenever you work on Vrykell code.
---

# Vrykell conventions

Vrykell is a Tauri 2 desktop app: React 19 + TypeScript frontend, Rust backend
(`src-tauri/`), terminal-first UI with AI chat (Anthropic BYOK). User-visible copy lives as
English strings in code with Chinese entries in `src/i18n`; all code comments are English.

## Commands

| Task | Command |
| --- | --- |
| Install dependencies | `npm install` |
| Frontend dev server (strict port 1420) | `npm run dev` |
| Full desktop app with hot reload | `npm run tauri dev` |
| Typecheck | `npx tsc --noEmit` |
| Unit tests (vitest, jsdom) | `npm run test` |
| E2E (playwright, starts its own server on 1421) | `npm run test:e2e` |
| Architecture boundaries | `npm run check:architecture` |
| Rust tests | `cargo test` in `src-tauri/` |

Before committing, run at least `npx tsc --noEmit`, `npm run test` and
`npm run check:architecture`. Run `cargo test` / e2e when the change can touch them.

## Hard constraints (never break)

1. Terminal parsing is xterm.js only. Never implement a VT/ANSI parser, and never show
   xterm in the UI (it exists for PTY handling and VT parsing, hidden).
2. No regex lookbehind (`(?<=...)`, `(?<!...)`) - macOS WKWebView rejects it. No lookahead
   tricks that rely on it either.
3. Never hardcode user-visible Chinese: write the string in English and add its Chinese entry
   to `src/i18n`. New or edited comments (JSDoc, inline, CSS, Rust) are English and use generic
   terms - no third-party brand names.
4. TypeScript strict: zero errors; avoid `any` unless unavoidable.
5. Colors come from `theme.css` variables - no hardcoded colors (ANSI palette excepted).
   Animations are 100 ms or slower.
6. Independent implementation: never copy third-party source code.

## Shared components (reuse, never fork)

- **Sidebar rows** - `src/ui/sidebarItem.tsx`. Session tab rows and SSH rows render through
  `SidebarItem`; a new list that looks like them must use it instead of hand-rolling markup.
- **List reordering** - `src/ui/listReorder.tsx`. The mechanic matches the titlebar buttons:
  the dragged row leaves its slot, a dashed placeholder marks the drop slot, an icon preview
  follows the pointer, Escape cancels and the post-drag click is suppressed. Lists opt in with
  `data-reorder-list` on the container and `data-reorder-item` (+ `data-reorder-kind`) on rows;
  rows start drags through `useListReorderDrag`, and gaps are rendered with
  `ListReorderPlaceholder` / `ListReorderZonePlaceholder`. Do not add a second reorder look.
- **Error surfaces** - `ErrorBox` (tone, title, message, actions, collapsible details) and
  `ErrorDetails` (collapsible raw text with copy) from `src/ui/`. A failure of something the
  panel is displaying renders inline through ErrorBox; a transient action result uses Toast.
  Bare `role="alert"` blocks are not acceptable.
- **Settings option groups** use the `Select` dropdown from `src/ui/Select.tsx`, not
  segmented pill controls.
- **Hover hints** go through `data-tip` and `src/ui/TooltipLayer.tsx` (one themed bubble).
  Components do not set `title` - the OS tooltip cannot be styled - and icon-only
  controls keep an `aria-label` as their accessible name.
- **Multi-select menus** use `src/ui/CheckboxMenu.tsx`: toggling keeps the menu open and
  it closes only when it loses focus (outside press or Escape).
- **One implementation per surface** - local and SSH file panels share the `FileOps`
  interface plus `filePanelConfig`; view code must not branch on the target or bypass the
  interface (rule 24 in `docs/zh/development-rules.md`).

## Architecture in one screen

```
PTY output -> Rust StreamScanner (src-tauri/src/terminal/scan.rs, synchronous)
           -> SessionController (src/features/terminal/services/pipeline/sessionController.ts,
              3-scene state machine, one per tab/pane)
           -> offscreen xterm per block, rendered as real DOM by TerminalBlockList
```

- `src/core/terminal/events.ts` mirrors the Rust `ScanEvent` as `DispatchEvent`.
- Domains: `src/features/agent` (stream, tools, permissions, MCP, context, memory,
  scheduling), `src/features/chat` (AiBlock, ToolRunCard, Markdown, PanelChat),
  `src/features/settings`, `src/features/ssh`, `src/features/files`, `src/features/search`,
  `src/features/terminal`, `src/features/workspace`.
- Infrastructure: `src/platform/` (Tauri IPC, PTY, fs, shells), `src/ui/` (business-agnostic
  components), `src/config/`, `src/utils/`, `src/i18n/`, `src/test-utils/`.
- `src-tauri/src/shell_integration.rs` owns the OSC 133/7 shell hooks.

## Testing

- Every feature gets vitest unit tests in the owning `__tests__/` directory.
- Every interactive feature gets Playwright e2e in `e2e/` (Tauri + Anthropic mocks live in
  `e2e/tauri-mock.ts`; the suite runs with a single worker).
- Assert user-visible behavior (labels, test ids, persisted settings), not implementation
  details. Coverage gates: 80% statements/functions/lines, 75% branches.
- When a refactor moves markup, either keep the existing hooks (`data-testid`,
  `data-tab-row-id`, `data-tab-group`, ARIA labels) or update every spec in the same commit.

## Workflow

1. Read the owning feature and the shared component before adding code.
2. Small focused commits; English subject with the `feat:` / `fix:` / `test:` / `refactor:` /
   `docs:` prefix, details as body bullets.
3. New features update the test checklist in `docs/zh/feature-spec.md` (mirror `docs/en/feature-spec.md`).
4. Definition of done: typecheck, unit tests and the architecture guard are green; e2e covers
   touched interactions; no dead code, unused imports or commented-out blocks remain.

## Deep references

- `AGENTS.md` - the always-on summary of these rules (Codex and other agents read it first).
- `docs/zh/development-rules.md` (mirror `docs/en/development-rules.md`) - the numbered rule book;
  this skill and that file must agree.
- `docs/zh/architecture.md` - pipeline and module detail.
- `docs/zh/pitfalls.md` - known traps worth reading before touching the terminal pipeline.
- `docs/zh/feature-spec.md` - feature specifications and test checklist.
- Docs are bilingual: Chinese in `docs/zh/`, English in `docs/en/`; keep both in sync when editing.
