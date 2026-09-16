/**
 * 后端 invoke API 层 —— 按领域拆分的统一入口。
 * 约定：每个领域一个文件，只封装 `invoke` 调用与返回类型；
 * 跨进程契约类型集中在 `@shared/api/types`。
 */
export * from '@shared/api/types';
export * from '@shared/api/search';
export * from '@shared/api/session';
export * from '@shared/api/group';
export * from '@shared/api/workspace';
