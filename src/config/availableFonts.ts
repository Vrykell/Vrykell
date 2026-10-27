/** Probe explicit local faces; generic fallback checks also succeed for missing families. */
export async function availableFontFamilies<T extends string>(candidates: readonly T[], bundled: readonly T[]): Promise<T[]> {
  const available = new Set<T>(bundled);
  if (typeof FontFace !== 'undefined') {
    await Promise.all(candidates.filter(font => !available.has(font)).map(async font => {
      const names = [font, `${font} Regular`, `${font.replace(/ /g, '')}-Regular`];
      const source = names.map(name => `local(${JSON.stringify(name)})`).join(', ');
      try {
        await new FontFace('LocalFontProbe', source).load();
        available.add(font);
      } catch {
        // Missing local faces are omitted without replacing saved preferences.
      }
    }));
  }
  return candidates.filter(font => available.has(font));
}
