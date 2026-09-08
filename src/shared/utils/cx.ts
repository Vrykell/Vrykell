/**
 * 极简 class 合并工具：用于 CSS Modules 中条件 class 组合。
 *
 * 用法：
 *   import s from './Foo.module.css';
 *   import { cx } from '@/shared/utils/cx';
 *   <div className={cx(s.base, active && s.active, error && s.error)} />
 *
 * 与 clsx 兼容（falsy 值被忽略），零依赖。
 */
export function cx(...args: (string | false | null | undefined)[]): string {
  return args.filter(Boolean).join(' ');
}
