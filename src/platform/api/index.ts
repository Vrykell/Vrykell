/**
 * Backend invoke API layer — a single entry point split by domain.
 * One file per domain, wrapping only `invoke` calls and their return types;
 * cross-process contract types live in `@platform/api/types`.
 */
export * from '@platform/api/types';
export * from '@platform/api/search';
export * from '@platform/api/session';
export * from '@platform/api/group';
export * from '@platform/api/workspace';
export * from '@platform/api/fs';
