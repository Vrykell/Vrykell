import type { CSSProperties, KeyboardEvent } from 'react';
import { t } from '@i18n';
import { getPresetPalette, paletteToCssVars, type ThemeMode } from '@config/theme/tokens';
import { resolveThemePreset, themePresets } from '@config/theme/presets';
import { Check, ChevronRight, iconSizes } from '@ui/icons';

export function ThemePresetPicker({ mode, value, onChange }: {
  mode: ThemeMode; value?: string; onChange: (id: string) => void;
}) {
  const presets = themePresets.filter(preset => preset.mode === mode);
  const selected = resolveThemePreset(mode, value).id;
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1
      : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 0;
    if (!direction && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? presets.length - 1
      : (index + direction + presets.length) % presets.length;
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    buttons?.[next]?.focus();
    onChange(presets[next].id);
  };
  return <div className="theme-preset-grid" role="radiogroup" aria-label={t(mode === 'dark' ? 'Dark color scheme' : 'Light color scheme')}>
    {presets.map((preset, index) => <button key={preset.id} type="button" className="theme-preset-choice"
      role="radio" aria-checked={selected === preset.id} tabIndex={selected === preset.id ? 0 : -1}
      onKeyDown={event => onKeyDown(event, index)} onClick={() => onChange(preset.id)}>
      <span className="theme-preset-preview" aria-hidden="true"
        style={paletteToCssVars(getPresetPalette(mode, preset.id)) as CSSProperties}>
        <span className="theme-preset-prompt"><ChevronRight size={iconSizes.compact} /><span>~/project</span><b>main</b><i /></span>
        <span className="theme-preset-files"><span>src</span> README <b>run.sh</b></span>
        <span className="theme-preset-swatches">{['red', 'yellow', 'green', 'cyan', 'blue', 'magenta'].map(color =>
          <i key={color} style={{ background: `var(--xterm-${color})` }} />)}</span>
      </span>
      <span className="theme-preset-label">{t(preset.name)}{selected === preset.id && <Check size={iconSizes.compact} aria-hidden="true" />}</span>
    </button>)}
  </div>;
}
