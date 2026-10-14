/**
 * harnessPresets — the harnesses users most often want, ready to add.
 *
 * Data, not code: each entry is a name plus the command line an ACP-capable agent is usually
 * started with. Nothing here is bundled with the app — the program has to be installed by the user,
 * and a wrong command line shows up immediately in "test connection" instead of failing silently.
 * Update an entry when the upstream invocation changes, and keep the appended hint short.
 */
export interface HarnessPreset {
  name: string;
  command: string;
  args: string[];
  /** How to get the program, shown next to the preset. */
  hint: string;
}

export const HARNESS_PRESETS: HarnessPreset[] = [
  { name: 'Claude Code', command: 'npx', args: ['-y', '@zed-industries/claude-code-acp'], hint: 'npx' },
  { name: 'Codex', command: 'npx', args: ['-y', '@zed-industries/codex-acp'], hint: 'npx' },
  { name: 'Gemini CLI', command: 'gemini', args: ['--experimental-acp'], hint: 'npm i -g @google/gemini-cli' },
  { name: 'OpenCode', command: 'opencode', args: ['acp'], hint: 'opencode.ai' },
  { name: 'Goose', command: 'goose', args: ['acp'], hint: 'block.github.io/goose' },
];

export interface HarnessEntry {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  enabled: boolean;
}

/**
 * Merge a preset into the list: an existing entry with the same name is replaced (the user clicked
 * the preset on purpose), everything else keeps its order.
 */
export function upsertPreset(list: HarnessEntry[], preset: HarnessPreset): HarnessEntry[] {
  const entry: HarnessEntry = { name: preset.name, command: preset.command, args: preset.args, env: {}, cwd: '', enabled: true };
  const index = list.findIndex((item) => item.name === preset.name);
  if (index < 0) return [...list, entry];
  return list.map((item, at) => (at === index ? { ...entry, cwd: item.cwd, env: item.env } : item));
}

/** Problems worth refusing to save for; empty means the list is fine. */
export function harnessProblems(list: Array<{ name: string; command: string }>): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  list.forEach((entry, index) => {
    if (!entry.name.trim()) problems.push(`#${index + 1}: no name`);
    else if (seen.has(entry.name.trim())) problems.push(`#${index + 1}: duplicate name`);
    else seen.add(entry.name.trim());
    if (!entry.command.trim()) problems.push(`#${index + 1}: no command`);
  });
  return problems;
}
