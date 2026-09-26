# AGENTS.md

## Project Overview

Tauri 2 desktop app: React 19 + TypeScript frontend, Rust backend. Terminal-first UI with AI chat integration (Anthropic BYOK).

## Quick Commands

```bash
npm install          # Install dependencies
npm run dev          # Frontend dev server (port 1420, strict)
npm run tauri dev    # Full Tauri app with hot reload
npm run build        # tsc + vite build
npm run test         # vitest run (unit tests, ports 1421 handled by e2e)
npm run test:e2e     # playwright test (e2e, starts dev server on 1421)
cargo test           # Rust backend tests (src-tauri/)
npx tsc --noEmit     # typecheck only (build also runs tsc)
```

## System Dependencies

macOS requires `libssh2` + `openssl` for SSH functionality:
```bash
brew install libssh2 openssl
```

## Critical Constraints

1. **No custom terminal emulator** - Use xterm.js for all VT/ANSI parsing. Never implement parser manually.
2. **No regex lookbehind** - macOS WKWebView doesn't support `(?<=...)` and `(?<!...)`.
3. **xterm.js must not be visible** - Only used for PTY session management and VT parsing, hidden from UI.
4. **Chinese UI** - All user-visible text must be in Chinese.
5. **TypeScript strict** - Zero TS errors, avoid `any` unless absolutely necessary.

## Testing Requirements

- **Every feature needs unit tests** - Place in `__tests__/` directories using vitest
- **Interactive features need e2e** - Place in `e2e/` directory using Playwright
- **Run all tests before commit** - `npx tsc --noEmit && npx vitest run && npx playwright test`

## Architecture

Terminal output flows through:
```
PTY output → Rust StreamScanner (scan.rs, synchronous) → SessionController (3-scene state machine) → offscreen xterm per block
```

Key files:
- `src-tauri/src/terminal/scan.rs` - **Rust** byte-level synchronous scanner (was `streamDispatcher.ts` in TS, sunk down)
- `src/core/terminal/events.ts` - `DispatchEvent` mirror of Rust `ScanEvent`
- `src/features/terminal/services/pipeline/sessionController.ts` - Block lifecycle + scene management (one per tab/pane)
- `src-tauri/src/terminal/pty.rs` - PTY session lifecycle
- `src-tauri/src/shell_integration.rs` - OSC 133/7 shell hooks

Domain layout:
- `src/features/agent/` - AI agent logic (agentStream, tools, permissions, skills, MCP, context, memory, scheduling, auto-title)
- `src/features/chat/` - AI render (AiBlock/ModelPill/ToolRunCard/Markdown/PanelChat)
- `src/features/settings/` - Settings pages and theme state
- `src/features/ssh/` `src/features/files/` `src/features/search/` - SSH / local files / global search
- `src/platform/` - Tauri IPC, PTY, filesystem, shells and runtime adapters

## File Organization

- `src/app/` - Application bootstrap, providers, root layout, global commands and dev entry
- `src/features/` - Business domains with colocated components, hooks, stores, services and models
- `src/platform/` - Tauri IPC and runtime infrastructure
- `src/core/` - Cross-domain protocols and contracts
- `src/ui/` - Business-agnostic UI components
- `src/config/` `src/utils/` `src/i18n/` `src/test-utils/` - Shared infrastructure
- `src-tauri/src/` - Rust backend

## Code Conventions

- Write new or edited code comments in English, including JSDoc, inline, CSS, and Rust comments
- Use generic terms in comments, avoid third-party brand names
- Independent implementation, don't copy third-party source code
- Colors via `theme.css` CSS variables, no hardcoded colors (except ANSI)
- Animations >= 0.1s, no faster transitions

## Test Setup

- Unit tests use jsdom with xterm.js canvas mock (`src/test-utils/setup.ts`)
- E2e tests use Playwright with Tauri + Anthropic mocks (`e2e/tauri-mock.ts`)
- Coverage thresholds: 80% statements/functions/lines, 75% branches
- Architecture guard: `npm run check:architecture`

## Commit Convention

Format: `feat:` / `fix:` / `test:` / `refactor:` / `docs:` - Small, focused commits.

## Documentation

- `docs/architecture.md` - Detailed v2 architecture
- `docs/development-rules.md` - Development rules and constraints
- `docs/feature-spec.md` - Feature specifications and test checklist
