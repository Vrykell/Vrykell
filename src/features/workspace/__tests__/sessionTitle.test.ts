import { describe, it, expect } from 'vitest';
import {
  canApplyTitle,
  normalizeCommandForTitle,
  resolveDisplayTitle,
  sanitizeTitle,
  truncateTitle,
} from '@features/workspace/model/sessionTitle';

describe('canApplyTitle', () => {
  it('fills a default title from any source', () => {
    expect(canApplyTitle(undefined, 'command')).toBe(true);
    expect(canApplyTitle(undefined, 'message')).toBe(true);
    expect(canApplyTitle(undefined, 'ai')).toBe(true);
    expect(canApplyTitle(undefined, 'manual')).toBe(true);
  });

  it('never overwrites a manual name', () => {
    expect(canApplyTitle('manual', 'command')).toBe(false);
    expect(canApplyTitle('manual', 'message')).toBe(false);
    expect(canApplyTitle('manual', 'ai')).toBe(false);
    expect(canApplyTitle('manual', 'manual')).toBe(true);
  });

  it('lets AI refresh any generated title but not the other way around', () => {
    expect(canApplyTitle('ai', 'ai')).toBe(true);
    expect(canApplyTitle('command', 'ai')).toBe(true);
    expect(canApplyTitle('message', 'ai')).toBe(true);
    expect(canApplyTitle('ai', 'command')).toBe(false);
    expect(canApplyTitle('ai', 'message')).toBe(false);
  });

  it('lets a message upgrade a command title but not vice versa, and never repeats', () => {
    expect(canApplyTitle('command', 'message')).toBe(true);
    expect(canApplyTitle('message', 'command')).toBe(false);
    expect(canApplyTitle('command', 'command')).toBe(false);
    expect(canApplyTitle('message', 'message')).toBe(false);
  });
});

describe('normalizeCommandForTitle', () => {
  it('keeps the program and up to two subcommands', () => {
    expect(normalizeCommandForTitle('npm run dev')).toBe('npm run dev');
    expect(normalizeCommandForTitle('docker compose up -d')).toBe('docker compose up');
    expect(normalizeCommandForTitle('git commit -m "msg"')).toBe('git commit');
  });

  it('drops environment prefixes, flags, arguments and paths', () => {
    expect(normalizeCommandForTitle('FOO=bar cargo test --all')).toBe('cargo test');
    expect(normalizeCommandForTitle('./scripts/build.sh --release')).toBe('build.sh');
    expect(normalizeCommandForTitle('git log --oneline -5')).toBe('git log');
  });

  it('returns empty for noise commands and blanks so the caller waits', () => {
    expect(normalizeCommandForTitle('ls -la')).toBe('');
    expect(normalizeCommandForTitle('cd /tmp')).toBe('');
    expect(normalizeCommandForTitle('   ')).toBe('');
    expect(normalizeCommandForTitle('')).toBe('');
  });
});

describe('resolveDisplayTitle', () => {
  it('shows a program title over a generated title', () => {
    expect(resolveDisplayTitle('终端', undefined, '⠋ Claude')).toBe('⠋ Claude');
    expect(resolveDisplayTitle('智能标题', 'ai', '⠋ Claude')).toBe('⠋ Claude');
  });

  it('never replaces a manual name and falls back when no program title is set', () => {
    expect(resolveDisplayTitle('我的窗口', 'manual', '⠋ Claude')).toBe('我的窗口');
    expect(resolveDisplayTitle('终端', undefined, '')).toBe('终端');
    expect(resolveDisplayTitle('终端', undefined, '   ')).toBe('终端');
  });
});

describe('sanitizeTitle / truncateTitle', () => {
  it('drops quotes and trailing punctuation and caps the length', () => {
    expect(sanitizeTitle('  「标题」。\n')).toBe('标题');
    expect(sanitizeTitle('a'.repeat(30))).toBe('a'.repeat(16));
    expect(sanitizeTitle('"\n')).toBe('');
  });

  it('truncates with an ellipsis past the cap', () => {
    expect(truncateTitle('abcdef', 3)).toBe('abc…');
    expect(truncateTitle('abc', 3)).toBe('abc');
  });
});
