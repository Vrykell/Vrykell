# AGENTS.md

## Project Overview

Tauri 2 desktop app: React 19 + TypeScript frontend, Rust backend. Terminal-first UI with AI chat integration (Anthropic BYOK). All user-visible text is Chinese.

## Quick Commands

```bash
npm install          # Install dependencies
npm run dev          # Frontend dev server (port 1420, strict)
npm run tauri dev    # Full Tauri app with hot reload
npm run build        # tsc + vite build
npm run test         # vitest run (unit tests)
npm run test:e2e     # playwright test (e2e, starts its own dev server on 1421)
cargo test           # Rust backend tests (src-tauri/)
npx tsc --noEmit     # typecheck only
npm run check:architecture  # import-boundary guard
```

macOS needs `libssh2` + `openssl` for SSH (`brew install libssh2 openssl`).

## Critical Constraints

1. **No custom terminal emulator** - xterm.js for all VT/ANSI parsing; it stays invisible (PTY + parsing only).
2. **No regex lookbehind** - macOS WKWebView rejects `(?<=...)` and `(?<!...)`.
3. **Chinese UI** - all user-visible text; new or edited code comments in English, generic terms, no brand names.
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

Load it before non-trivial changes. `docs/development-rules.md` is the numbered rule book and
stays the source of truth; keep the skill and that file consistent when rules change.

## Testing Requirements

- **Every feature needs unit tests** - in the owning `__tests__/` directory using vitest.
- **Interactive features need e2e** - in `e2e/` using Playwright (`tauri-mock.ts` mocks Tauri + Anthropic; single worker).
- **Run before commit** - `npx tsc --noEmit && npm run test && npm run check:architecture`, plus `npm run test:e2e` / `cargo test` when the change can touch them.

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

`feat:` / `fix:` / `test:` / `refactor:` / `docs:` - small, focused commits.

## Documentation

- `.agents/skills/vrykell-conventions/SKILL.md` - project conventions skill (load it)
- `docs/architecture.md` - detailed architecture
- `docs/development-rules.md` - numbered development rules (source of truth)
- `docs/feature-spec.md` - feature specifications and test checklist
- `docs/pitfalls.md` - known traps
