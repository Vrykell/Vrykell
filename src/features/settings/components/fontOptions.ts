import { useEffect, useState } from 'react';
import { TERMINAL_FONT_PRESETS, UI_FONT_PRESETS } from '@config/typography';
import { BUNDLED_MONO_FONTS, BUNDLED_UI_FONTS } from '@config/bundledFonts';
import { availableFontFamilies } from '@config/availableFonts';
import { t } from '@i18n';

function useAvailableFonts<T extends string>(candidates: readonly T[], bundled: readonly T[]) {
  const [available, setAvailable] = useState<readonly T[]>(bundled);
  useEffect(() => {
    if (typeof FontFace === 'undefined') return;
    let active = true;
    const refresh = () => { void availableFontFamilies(candidates, bundled).then(fonts => { if (active) setAvailable(fonts); }); };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, [candidates, bundled]);
  return available.map(value => ({ value, label: value }));
}

const monoCandidates = TERMINAL_FONT_PRESETS.filter(font => font !== 'system' && font !== 'system-default');
const uiCandidates = UI_FONT_PRESETS.filter(font => font !== 'system');
const bundledUiFamilies = [...BUNDLED_UI_FONTS, ...BUNDLED_MONO_FONTS];

export function useMonospaceFontOptions() {
  const fonts = useAvailableFonts(monoCandidates, BUNDLED_MONO_FONTS);
  return [{ value: 'system-default' as const, label: t('System default font') }, ...fonts];
}
export function useUiFontOptions() {
  const fonts = useAvailableFonts(uiCandidates, bundledUiFamilies);
  return [{ value: 'system' as const, label: t('System default font') }, ...fonts];
}
