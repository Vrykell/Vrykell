/**
 * 后端 invoke API 层 —— 按领域拆分的统一入口。
 * 约定：每个领域一个文件，只封装 `invoke` 调用与返回类型；
 * 跨进程契约类型集中在 `@platform/api/types`。
 */
export * from '@platform/api/types';
export * from '@platform/api/search';
export * from '@platform/api/session';
export * from '@platform/api/group';
export * from '@platform/api/workspace';
