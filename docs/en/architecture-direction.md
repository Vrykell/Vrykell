# Frontend Architecture Evolution Direction

## Decision

Going forward, Vrykell adopts an architecture centered on business Features. Referencing Lithe-IDEA's way of organizing, it avoids further expanding the mixed layers of `app / entities / widgets / features / legacy business directories`.

Current structure:

```text
src/
├── app/             Application startup, global Providers, root layout
├── features/        Business domains; each domain consolidates components, Hooks, Store, Service, Types, Utils
│   ├── workspace/
│   ├── terminal/
│   ├── chat/
│   ├── session-history/
│   ├── files/
│   ├── ssh/
│   ├── search/
│   ├── settings/
│   └── window/
├── ui/              Generic UI components with no business semantics
├── platform/        Platform adaptation for Tauri, PTY, filesystem, etc.
├── core/            Cross-business core protocols and foundational services
├── config/          Application configuration and defaults
├── i18n/            Internationalization
├── utils/           Pure functions and general utilities
├── mocks/           Test Mocks
└── test-utils/      Test infrastructure
```

## Constraints

- A business domain has only one main directory; the same domain may not maintain two implementations simultaneously in a top-level directory and in `features`.
- A Feature may be split internally by responsibility, but externally it is accessed only through the Feature's public entry.
- Stores, Services, IPC, and components do not penetrate each other across layers; Tauri calls are concentrated in `platform` or the Feature's `services`.
- `ui`, `utils`, and `core` are not allowed to depend on specific business Features.
- Modules access domain capabilities only through Feature public entries; no legacy-directory compatibility exports are retained.
- Every vertical slice must pass TypeScript, unit tests, and the relevant E2E tests.

## Rollout Order

1. Establish Feature public entries and architecture gates.
2. Merge the components, Hooks, Stores, and services of terminal, chat, and workspace into their respective Features.
3. Merge files, ssh, search, settings, and session-history into their Feature internals.
4. Consolidate the Tauri IPC, PTY, filesystem, and window APIs into `platform`.
5. Clean up the compatibility layer, split lazy-loading boundaries by Feature, and address build artifact size.

This phase has completed the migration of directories, aliases, entries, platform adaptation, and architecture gates as runnable vertical slices.
