# Frontend Architecture Conventions

## Goals

The frontend adopts a directory structure centered on business Features. Business state, components, Hooks, services, and types are consolidated by domain, and general capabilities are pushed down to a shared layer with no business semantics.

```text
src/
├─ app/          Application startup, Providers, root layout, global commands, and development entry
├─ features/     Business domains; each domain owns its own components, state, services, model, and Hooks
├─ platform/     Tauri IPC, PTY, filesystem, and runtime adaptation
├─ core/         Cross-business protocols and foundational contracts
├─ ui/           Generic UI with no business semantics
├─ config/       Static configuration and design tokens
├─ utils/        Pure functions and general utilities
├─ i18n/         Internationalization
├─ test-utils/   Test infrastructure
└─ assets/       Static assets
```

Current business domains:

- `features/workspace`: tab, split pane, Dock, and session workspace state
- `features/terminal`: terminal components, input bar, block state, and Rust scan event consumption
- `features/chat`: AI conversation rendering and chat state
- `features/agent`: Agent streams, tools, permissions, context, Skills, MCP, and scheduling
- `features/files`, `features/ssh`, `features/search`
- `features/settings`, `features/session-history`

## Dependency Direction

```text
app → features → platform / core / ui / config / utils
```

- `app` is responsible for composing business capabilities and does not reimplement domain logic.
- `features/*` expose capabilities to other modules only through the domain's public entry.
- `platform`, `core`, `ui`, `config`, and `utils` must not depend in reverse on `app` or `features`.
- `ui` contains no business state; interactive behavior goes into the corresponding Feature's Hook.
- IPC calls are concentrated in `platform` or the Feature's `services`.

`npm run check:architecture` is responsible for checking legacy directories, reverse dependencies, and direct Store access from the view layer.

## Application Startup Conventions

- `main.tsx` is responsible only for preload, Provider mounting, and React root mounting.
- `app/bootstrap` is responsible for task orchestration, error isolation, and cleanup, and does not render UI.
- `app/App.tsx` connects the application lifecycle, global interactions, and `AppShell`.
- Long-lived subscriptions, timers, and event listeners must return a cleanup.
- Feature initialization must be connected through an explicit startup function or dependency injection, and must not produce side effects at module import time.

## Naming and Testing

- Components use PascalCase, Hooks use `useXxx`, and pure business functions start with a verb.
- A file assumes only one primary responsibility.
- State transitions, IPC adaptation, and pure business logic must have unit tests.
- User paths such as keyboard, drag-and-drop, popups, and async recovery must have Playwright E2E.
- User-visible copy goes through i18n (an English string in code plus a Chinese entry in `src/i18n`), and colors use theme CSS variables.
