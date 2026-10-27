export const BUNDLED_MONO_FONT = 'Maple Mono NF CN';
export const BUNDLED_MONO_FONTS = [BUNDLED_MONO_FONT, 'Cascadia Code', 'JetBrains Mono'] as const;
export const BUNDLED_UI_FONTS = ['Noto Sans SC', 'Inter'] as const;

/** Load local faces before text renderers measure their first cells. */
export async function loadBundledFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const sample = 'AaBb 0123 \u4e2d\u6587 ─│┌┐ \uf115 \ue0a0';
  await Promise.allSettled([
    document.fonts.load('400 14px "Noto Sans SC"', sample),
    document.fonts.load(`400 14px "${BUNDLED_MONO_FONT}"`, sample),
    document.fonts.load(`700 14px "${BUNDLED_MONO_FONT}"`, sample),
    document.fonts.load('400 14px "Cascadia Code"', sample),
    document.fonts.load('400 14px "JetBrains Mono"', sample),
    document.fonts.load('400 14px "Inter"', sample),
  ]);
}
