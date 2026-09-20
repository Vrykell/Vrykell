import { createContext, useContext, type ReactNode } from 'react';
import zh from '@i18n/zh';

// ── 类型 ──

export type Locale = 'zh';
export type I18nKey = keyof typeof zh;

// ── 翻译注册表 ──

const messages: Record<Locale, Record<I18nKey, string>> = { zh };

// ── 插值辅助 ──

function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  let result = s;
  for (const [k, v] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
  }
  return result;
}

// ── Context ──

interface I18nCtx {
  locale: Locale;
  t: (key: I18nKey, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18nCtx>({
  locale: 'zh',
  t: (key, vars) => interpolate(messages.zh[key] ?? key, vars),
});

// ── Provider ──

export function I18nProvider({ locale = 'zh', children }: { locale?: Locale; children: ReactNode }) {
  const t = (key: I18nKey, vars?: Record<string, string | number>) => {
    const s = (messages[locale]?.[key]) ?? messages.zh[key] ?? key;
    return interpolate(s, vars);
  };
  return <Ctx.Provider value={{ locale, t }}>{children}</Ctx.Provider>;
}

// ── Hook ──

export function useT() {
  const { t, locale } = useContext(Ctx);
  return { t, locale };
}

/** 组件外（store / callback）使用的翻译函数，默认中文。 */
export function t(key: I18nKey, vars?: Record<string, string | number>): string {
  return interpolate(messages.zh[key] ?? key, vars);
}
