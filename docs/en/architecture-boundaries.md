# Frontend Architecture Boundaries

## Dependency Direction

```text
Pages / Components
    ↓
Feature Hook / Public Entry
    ↓
Feature Model / Store / Service
    ↓
Platform IPC / Core Protocol
```

The view layer must not import `src/features/*/stores` directly. When domain state needs to be read, use the corresponding Feature's public entry; when state, async requests, and side effects need to be composed, put them in that Feature's `hooks/`.

Current domain public entries:

- `src/features/agent/index.ts`
- `src/features/chat/index.ts`
- `src/features/files/index.ts`
- `src/features/search/index.ts`
- `src/features/session-history/index.ts`
- `src/features/settings/index.ts`
- `src/features/ssh/index.ts`
- `src/features/terminal/index.ts`
- `src/features/workspace/index.ts`

## Layered Responsibilities

- `app/`: application composition root, startup orchestration, root layout, global commands, and Providers.
- `features/`: business domains, internally divided by responsibility into `components / hooks / model / services / stores / utils`.
- `platform/`: Tauri, PTY, filesystem, window, and runtime adaptation.
- `core/`: cross-business protocols and stable contracts.
- `ui/`: generic components with no business semantics.
- `config/`, `utils/`, `i18n/`, `test-utils/`: static configuration, pure functions, internationalization, and test infrastructure.

## Hook Responsibilities

Hooks are responsible for the React lifecycle and interaction orchestration, not for rendering layout. Components are responsible for presentation and event binding, and do not directly handle cross-domain Stores, IPC, or session recovery flows.

Every newly added Hook needs at least one unit test; when it involves user paths such as keyboard, drag-and-drop, popups, or async recovery, Playwright E2E coverage is also required.

`npm run check:architecture` checks for legacy directories, reverse dependencies from lower layers, view-layer Store penetration, and that every frontend IPC command exists in the Rust registry (`generate_handler!`).
