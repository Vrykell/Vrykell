---
name: ai-terminal-project
description: AI Terminal desktop app project — Electron + React + xterm.js terminal emulator with LaTeX/Markdown/code rendering
metadata:
  type: project
  updated: 2026-07-20
---

# AI Terminal Project

**Location**: `~/ai-terminal/`
**Status**: Phase 1 code complete, blocked by Electron `require('electron')` bug (affects v28~32)
**Plan**: `~/.claude/plans/buzzing-greeting-dahl.md`

## Project Summary
Desktop terminal emulator (Electron + React 18 + xterm.js 5) with:
- Local PTY + remote SSH
- LaTeX (KaTeX), Markdown (marked), code syntax highlighting (Shiki) rendering
- AI chat panel + command suggestions + AI SDK for Claude Code integration

## Key Technical Decisions
- Electron over Tauri: node-pty maturity, AI SDK native support, MessagePort IPC
- React over Lit: complex UI (AI panel, settings, split panes)
- xterm.js Decorations API for rich content overlay
- OSC escape sequence protocol for AI tool markers
- ISessionBackend interface for future Tauri migration
- Web Worker architecture for content detection (off main thread)
- Zustand for state management

## Current State (2026-07-20)
- All Phase 1 source files written and TypeScript-compiled successfully
- Electron tested: 28.3.3, 30.0.0, 32.3.3 — ALL have `require('electron')` returning path string
- **Even a minimal fresh Electron app fails** — not project-specific
- Debug scripts created: `debug-electron.cjs`, `test-entry.cjs` at project root
- `electron-prelude.ts` now a no-op (patching was ineffective)
- `package.json`: `"type": "commonjs"`, entry `main-wrapper.mjs`

## Fixes Applied This Session
1. `package.json`: `"type": "module"` → `"type": "commonjs"` (CJS compiled code was breaking as ESM)
2. `electron-prelude.ts`: Rewrote from `_resolveFilename` path filtering → `Module._load` interception → no-op
3. `main-wrapper.mjs`: ESM `import` → `createRequire` approach (correct pattern, blocked by upstream bug)
4. Upgraded Electron: 28.3.3 → 32.3.3 (did not fix, changed back)

## Recommended Next Action
- Try Electron 43+ (latest) — official quick-start confirmed working
- Or use electron-forge toolchain
- Phase 2 code can be developed in parallel (pure TypeScript, no Electron runtime needed)
