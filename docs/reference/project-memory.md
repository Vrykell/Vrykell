---
name: ai-terminal-project
description: AI Terminal desktop app project — Electron + React + xterm.js terminal emulator with LaTeX/Markdown/code rendering
metadata:
  type: project
  updated: 2026-07-20
---

# AI Terminal Project

**Location**: `D:\projects\typescript\ai-terminal\`
**Status**: Phase 1 code complete. Electron upgraded to 43.1.0 (recommended fix). Needs `npm install` + `npm run build` to verify the blocking bug is resolved.
**Plan**: `docs/plan.md`

## Project Summary
Desktop terminal emulator (Electron 43 + React 18 + xterm.js 5) with:
- Local PTY + remote SSH
- LaTeX (KaTeX), Markdown (marked), code syntax highlighting (Shiki) rendering
- AI chat panel + command suggestions + AI SDK for Claude Code integration

## Architecture (Three-Layer Electron App)
```
Main Process (Node.js)  ──IPC──>  Preload (contextBridge)  ──IPC──>  Renderer (React + xterm.js)
```
- **Main**: pty-manager (node-pty), ipc-handlers (routing), session-store, ai-bridge stub, ssh-client stub
- **Preload**: 8 methods + 8 event listeners via contextBridge
- **Renderer**: xterm.js with WebGL addon, React 18 with Zustand store, TerminalTabs, RichOutput, AIChatPanel, StatusBar

## Key Technical Decisions
- Electron over Tauri: node-pty maturity, AI SDK native support, MessagePort IPC
- React over Lit: complex UI (AI panel, settings, split panes)
- xterm.js Decorations API for rich content overlay
- OSC escape sequence protocol for AI tool markers (OSC code 6969)
- ISessionBackend interface for future Tauri migration
- Web Worker architecture for content detection (off main thread)
- Zustand for state management (lightweight, immutable updates)

## Current State (2026-07-20)
- All Phase 1 source files written and TypeScript-compiles successfully
- **Electron upgraded to 43.1.0** in package.json — this is the recommended fix for the require('electron') bug
- `electron-prelude.ts` is now a no-op (patching was ineffective; Electron 43 should not need it)
- `package.json`: `"type": "commonjs"`, entry `main-wrapper.mjs`
- No node_modules/ or dist/ — need `npm install` + build

## Blocking Bug History (Electron 28-32)
- `require('electron')` returned binary path string instead of API object
- Affected Electron 28.3.3, 30.0.0, 32.3.3 on macOS
- npm `electron` package's index.js intercepted require() before Electron built-in
- Electron 43 is the recommended fix — official quick-start confirmed working
- Full analysis: [[electron-require-issue]], [[module-resolution-deep-dive]]

## Five-Phase Plan
| Phase | Status | Description |
|-------|--------|-------------|
| 1 - Core Terminal | ⚠️ Code done, needs runtime verification | Local PTY + tabs |
| 2 - Rich Content | 🚧 Can develop in parallel | LaTeX/Markdown/Code rendering |
| 3 - AI Integration | ⏳ Planned | Claude API chat panel + SDK |
| 4 - Remote & Advanced | ⏳ Planned | SSH, persistence, split panes |
| 5 - Packaging | ⏳ Planned | electron-builder, auto-update, docs |
