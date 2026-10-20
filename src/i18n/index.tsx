import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import zh from '@i18n/zh';
import en from '@i18n/en';
import { resolveLocale, useLanguagePreferences, type Locale } from './preferences';
export { useLanguagePreferences, resolveLocale } from './preferences';
export type { Locale, LanguagePreference } from './preferences';

export type I18nKey = keyof typeof zh;

function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  let result = text;
  for (const [key, value] of Object.entries(vars)) result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
  return result;
}

function translate(locale: Locale, key: I18nKey, vars?: Record<string, string | number>): string {
  return interpolate((locale === 'zh' ? zh[key] : en[key]) ?? key, vars);
}

export function t(key: I18nKey, vars?: Record<string, string | number>): string {
  return translate(resolveLocale(useLanguagePreferences.getState().preference), key, vars);
}

const englishLabels = new Map(Object.entries(zh).flatMap(([key, value]) => {
  const label = en[key] ?? (/^[a-z][\w]*\.[\w.]+$/.test(key) ? undefined : key);
  return label ? [[value, label] as const] : [];
}));

/** Resolve existing catalog-backed labels supplied by stored UI definitions. */
export function localizeLabel(text: string | undefined): string | undefined {
  return text && resolveLocale(useLanguagePreferences.getState().preference) === 'en' ? englishLabels.get(text) ?? text : text;
}

const Ctx = createContext({ locale: 'zh' as Locale, t });

/** Language changes update the interface without remounting sessions or editors. */
export function I18nProvider({ locale: override, children }: { locale?: Locale; children: ReactNode }) {
  const preference = useLanguagePreferences(state => state.preference);
  const [, updateSystem] = useState(0);
  const locale = override ?? resolveLocale(preference);
  useEffect(() => {
    const language = () => updateSystem(value => value + 1);
    const storage = (event: StorageEvent) => { if (event.key === 'vrykell-language') void useLanguagePreferences.persist.rehydrate(); };
    window.addEventListener('languagechange', language);
    window.addEventListener('storage', storage);
    return () => { window.removeEventListener('languagechange', language); window.removeEventListener('storage', storage); };
  }, []);
  useEffect(() => { document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'; }, [locale]);
  return <Ctx.Provider value={{ locale, t: (key, vars) => translate(locale, key, vars) }}>{children}</Ctx.Provider>;
}

export function useT() { return useContext(Ctx); }
