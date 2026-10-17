# AGENTS.md

## Project Overview

Tauri 2 desktop app: React 19 + TypeScript frontend, Rust backend. Terminal-first UI with AI chat integration (Anthropic BYOK). User-visible copy lives as English strings in code with Chinese entries in the i18n catalog.

## Quick Commands

```bash
npm install          # Install dependencies
npm run dev          # Frontend dev server (port 1420, strict)
npm run tauri dev    # Full Tauri app with hot reload
npm run build        # tsc + vite build
npm run test         # vitest run (unit tests)
npm run test:e2e     # playwright test (e2e; dev server port from PW_PORT, default 1421)
cargo test           # Rust backend tests (src-tauri/)
npx tsc --noEmit     # typecheck only
npm run check:architecture  # import-boundary guard
```

macOS builds `libssh2` + OpenSSL from source for SSH, without Homebrew or system OpenSSL.
Xcode Command Line Tools, Perl and Make are required (`xcode-select --install`).

## Critical Constraints

**Existing design first:** inspect the closest existing UI and reuse its components, spacing, input, menu, hover, and focus patterns. Extend or extract existing code instead of inventing another visual treatment. Review narrow and wide layouts in the running UI.

**Menu hierarchy:** color palettes always sit directly below actions in the shared menu footer. Use meaningful submenus for multiple related choices; keep single settings destinations and switches directly accessible without a generic Settings parent.

1. **No custom terminal emulator** - xterm.js for all VT/ANSI parsing; it stays invisible (PTY + parsing only).
2. **No regex lookbehind** - macOS WKWebView rejects `(?<=...)` and `(?<!...)`.
3. **i18n for user-visible text** - never hardcode user-visible Chinese in code: write the string in English and add its Chinese entry to the i18n catalog (`src/i18n`). Code comments in new or edited code are English, generic terms, no brand names.
4. **TypeScript strict** - zero errors, avoid `any`.
5. **Theme variables only** - colors via `theme.css` (ANSI excepted); animations >= 100 ms.
6. **Independent implementation** - never copy third-party source.

## Conventions Skill

The full agent-facing rule set - shared components, architecture map, testing and commit
rules, definition of done - lives in the project skill:

```
.agents/skills/vrykell-conventions/SKILL.md    # canonical (Command Code + Codex)
.claude/skills/vrykell-conventions/SKILL.md    # bridge for Claude Code, frontmatter kept in sync
```

Load it before non-trivial changes. `docs/zh/development-rules.md` is the numbered rule book
(English mirror `docs/en/development-rules.md`) and stays the source of truth; keep the skill and
that file consistent when rules change.

## Testing Requirements

- **Every feature needs unit tests** - in the owning `__tests__/` directory using vitest.
- **Interactive features need e2e** - in `e2e/` using Playwright (`tauri-mock.ts` mocks Tauri + Anthropic; single worker).
- **Run before commit** - `npx tsc --noEmit && npm run test && npm run check:architecture`, plus `npm run test:e2e` / `cargo test` when the change can touch them.

## Diagnosing Runtime Problems

The app records structured diagnostics; read them before asking for a reproduction:
`%LOCALAPPDATA%\com.vrykell.app\logs\diagnostics-<YYYYMMDDTHH>.jsonl` (the name carries the UTC
hour, so segments rotate hourly and the newest 24 / 256 MB are kept; the
`autoSave` flag lives in `%APPDATA%\com.vrykell.app\diagnostics.json`). Only metadata is
recorded - command text, terminal output and key payloads are redacted - so when a question needs
something the log cannot give, add a stable `terminalDebug(...)` marker and read the log again.
See rules 36-41 in `docs/zh/development-rules.md`.

## Architecture

```
PTY output -> Rust StreamScanner (src-tauri/src/terminal/scan.rs)
           -> SessionController (3-scene state machine, one per tab/pane)
           -> offscreen xterm per block, rendered as real DOM
```

Key files: `src-tauri/src/terminal/scan.rs`, `src/core/terminal/events.ts`,
`src/features/terminal/services/pipeline/sessionController.ts`,
`src-tauri/src/terminal/pty.rs`, `src-tauri/src/shell_integration.rs`.

Domains: `src/features/agent` (stream, tools, permissions, MCP, context, memory, scheduling),
`src/features/chat`, `src/features/settings`, `src/features/ssh`, `src/features/files`,
`src/features/search`, `src/features/terminal`, `src/features/workspace`.

Layers: `src/app` (bootstrap, providers, root layout), `src/platform` (Tauri IPC, PTY, fs,
shells), `src/core` (cross-domain contracts), `src/ui` (business-agnostic components),
`src/config` `src/utils` `src/i18n` `src/test-utils`, `src-tauri/src` (Rust backend).

## Commit Convention

English commit messages (subject and body), prefix `feat:` / `fix:` / `test:` / `refactor:` / `docs:` - small, focused commits.

## Documentation

Docs are bilingual: Chinese in `docs/zh/`, English in `docs/en/` - keep both in sync when editing.

- `.agents/skills/vrykell-conventions/SKILL.md` - project conventions skill (load it)
- `docs/zh/architecture.md` (mirror `docs/en/architecture.md`) - detailed architecture
- `docs/zh/development-rules.md` (mirror `docs/en/development-rules.md`) - numbered development rules (source of truth)
- `docs/zh/security-model.md` (mirror `docs/en/security-model.md`) - the security model, its defences and the checklist every new IPC command, rendering path or third-party integration must answer
- `docs/zh/feature-spec.md` (mirror `docs/en/feature-spec.md`) - feature specifications and test checklist
- `docs/zh/pitfalls.md` (mirror `docs/en/pitfalls.md`) - known traps
- `docs/audit-evidence/` - screenshots referenced by the audit docs (not translated)
