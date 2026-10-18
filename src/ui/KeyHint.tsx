import { Command } from './icons';

const paths: Record<string, string> = {
  Shift: 'M3 9 8 3l5 6h-3v4H6V9Z',
  Alt: 'M3 4h3l4 8h3M10 4h3',
  Control: 'm3 10 5-5 5 5',
  Enter: 'M12 3v6H3m3-3L3 9l3 3',
  Escape: 'M12 11V4H4m3 3L4 4l3-3',
  ArrowUp: 'M8 13V3m-4 4 4-4 4 4',
  ArrowDown: 'M8 3v10m-4-4 4 4 4-4',
  ArrowLeft: 'M13 8H3m4-4L3 8l4 4',
  ArrowRight: 'M3 8h10m-4-4 4 4-4 4',
  Tab: 'M3 8h9m-4-4 4 4-4 4M13 3v10',
  Backspace: 'm2 8 4-5h8v10H6Zm6-2 4 4m0-4-4 4',
  End: 'M3 3v10m0-5h9m-4-4 4 4-4 4',
  Home: 'M13 3v10m0-5H4m4-4-4 4 4 4',
  Delete: 'm14 8-4-5H2v10h8Zm-6-2-4 4m0-4 4 4',
  Space: 'M3 6v5h10V6',
  PageUp: 'm4 7 4-4 4 4m-8 5 4-4 4 4',
  PageDown: 'm4 4 4 4 4-4m-8 5 4 4 4-4',
};

export function shortcutKeys(shortcut: string): string[] {
  return shortcut.replace(/⌘/g, 'Meta+').replace(/⇧/g, 'Shift+').replace(/⌥/g, 'Alt+')
    .replace(/⌃/g, 'Control+').split('+').filter(Boolean).map(key => {
      const value = key.trim();
      return ({ Cmd: 'Meta', Command: 'Meta', Ctrl: 'Control', Option: 'Alt', Return: 'Enter', Esc: 'Escape', '↑': 'ArrowUp', '↓': 'ArrowDown', '←': 'ArrowLeft', '→': 'ArrowRight', '↵': 'Enter', Spacebar: 'Space' } as Record<string, string>)[value] ?? value;
    });
}

/** Modifier and navigation keys use glyphs, while letter keys retain their labels. */
export default function KeyHint({ shortcut }: { shortcut: string }) {
  const keys = shortcutKeys(shortcut);
  return <kbd className="key-hint" role="img" aria-label={keys.join('+')}>
    {keys.map((key, index) => key === 'Meta'
      ? <Command key={index} size={14} aria-hidden="true" data-key-icon={key} />
      : paths[key] ? <svg key={index} width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" data-key-icon={key}>
        <path d={paths[key]} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg> : <span key={index}>{key}</span>)}
  </kbd>;
}
