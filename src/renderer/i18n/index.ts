import type { LocaleDict } from './types';
import en from './en';
import zh from './zh';

/**
 * Compile-time locale selection via VITE_LOCALE env var.
 *
 *   VITE_LOCALE=zh npm run build:renderer   → 中文版
 *   npm run build:renderer                   → English (default)
 *
 * The unused locale import is tree-shaken out of the production bundle.
 */
const LOCALE = import.meta.env.VITE_LOCALE || 'en';

const DICTS: Record<string, LocaleDict> = { en, zh };

/** The active translation table. Use as a plain object: `t.exit.title`. */
export const t: LocaleDict = DICTS[LOCALE] || en;
