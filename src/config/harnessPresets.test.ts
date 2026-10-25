import { describe, expect, it } from 'vitest';
import { HARNESS_PRESETS, harnessProblems, upsertPreset, type HarnessEntry } from './harnessPresets';

const preset = HARNESS_PRESETS[0]!;

describe('upsertPreset', () => {
  it('appends a preset that is new and replaces one with the same name', () => {
    const added = upsertPreset([], preset);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ name: preset.name, command: preset.command, enabled: true, cwd: '' });

    const edited: HarnessEntry[] = [{ ...added[0]!, cwd: '/tmp/project', args: ['custom'] }];
    const replaced = upsertPreset(edited, preset);
    expect(replaced).toHaveLength(1);
    expect(replaced[0]!.args).toEqual(preset.args);
    // A preset fills the command line; a working directory the user set stays.
    expect(replaced[0]!.cwd).toBe('/tmp/project');
  });
});

describe('harnessProblems', () => {
  it('refuses nameless, commandless and duplicated entries', () => {
    expect(harnessProblems([{ name: 'a', command: 'x' }])).toEqual([]);
    expect(harnessProblems([{ name: ' ', command: 'x' }])).toEqual(['#1: no name']);
    expect(harnessProblems([{ name: 'a', command: '  ' }])).toEqual(['#1: no command']);
    expect(harnessProblems([{ name: 'a', command: 'x' }, { name: ' a ', command: 'y' }]))
      .toEqual(['#2: duplicate name']);
  });
});

describe('HARNESS_PRESETS', () => {
  it('every preset is startable as written and carries a hint', () => {
    expect(HARNESS_PRESETS.length).toBeGreaterThan(0);
    for (const entry of HARNESS_PRESETS) {
      expect(entry.name.trim()).not.toBe('');
      expect(entry.command.trim()).not.toBe('');
      expect(entry.hint.trim()).not.toBe('');
    }
  });

  it('names the program a wrapper preset needs before it can run', () => {
    // The npx package is only the adapter; the program it starts has to be installed too.
    const pi = HARNESS_PRESETS.find((entry) => entry.name === 'Pi');
    expect(pi?.hint).toContain('@earendil-works/pi-coding-agent');
  });
});
