import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Locale = 'zh' | 'en';
export type LanguagePreference = Locale | 'system';

export function resolveLocale(preference: LanguagePreference): Locale {
  return preference === 'system' ? (/^zh/i.test(navigator.language) ? 'zh' : 'en') : preference;
}

export const useLanguagePreferences = create<{
  preference: LanguagePreference;
  setPreference: (preference: LanguagePreference) => void;
}>()(persist(set => ({
  preference: 'zh',
  setPreference: preference => set({ preference }),
}), { name: 'vrykell-language', merge: (saved, current) => {
  const value = saved as { preference?: unknown } | null;
  return { ...current, preference: value?.preference === 'en' || value?.preference === 'system' ? value.preference : 'zh' };
} }));
