import { resolveLocale, t, useLanguagePreferences } from '@i18n';

export function hostLastConnected(timestamp?: number, now = Date.now()): string {
  if (!timestamp || !Number.isFinite(timestamp)) return '—';
  const locale = resolveLocale(useLanguagePreferences.getState().preference);
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60_000) return t('Just now');
  if (elapsed < 3_600_000) return new Intl.RelativeTimeFormat(locale).format(-Math.floor(elapsed / 60_000), 'minute');
  const date = new Date(timestamp);
  const today = new Date(now);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  if (date.toDateString() === today.toDateString()) return t('Today {{time}}', { time });
  if (date.toDateString() === yesterday.toDateString()) return t('Yesterday {{time}}', { time });
  return date.toLocaleDateString(locale, { year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined, month: 'short', day: 'numeric' });
}
