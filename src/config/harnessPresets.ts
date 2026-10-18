/**
 * harnessPresets — the harnesses users most often want, ready to add.
 *
 * Data, not code: each entry is a name plus the command line an ACP-capable agent is usually
 * started with. Nothing here is bundled with the app — the program has to be installed by the user,
 * and a wrong command line shows up immediately in "test connection" instead of failing silently.
 * Update an entry when the upstream invocation changes, and keep the appended hint short.
 */
import type { I18nKey } from '@i18n';

export interface HarnessPreset {
  name: string;
  command: string;
  args: string[];
  /** How to get the program, shown next to the preset. */
  hint: I18nKey;
}

export const HARNESS_PRESETS: HarnessPreset[] = [
  // Verified end to end: handshake, session and a whole turn (2026-10).
  { name: 'Claude Code', command: 'npx', args: ['-y', '@zed-industries/claude-code-acp'], hint: 'Run with npx; answers a whole turn.' },
  { name: 'Codex', command: 'npx', args: ['-y', '@agentclientprotocol/codex-acp'], hint: 'Run with npx; answers a whole turn, the first one may take a while.' },
  { name: 'Gemini CLI', command: 'npx', args: ['-y', '@google/gemini-cli', '--experimental-acp'], hint: 'Run with npx; needs a Google account or an API key.' },
  { name: 'OpenCode', command: 'opencode', args: ['acp'], hint: 'Requires opencode (npm i -g opencode-ai) and a one-time opencode auth login.' },
  { name: 'Qwen Code', command: 'qwen', args: ['--acp'], hint: 'Requires qwen (npm i -g @qwen-code/qwen-code); answers a whole turn.' },
  { name: 'Cursor', command: 'cursor-agent', args: ['acp'], hint: 'Requires cursor-agent.' },
  { name: 'OpenClaw', command: 'openclaw', args: ['acp'], hint: 'Requires openclaw.' },
  { name: 'Kiro CLI', command: 'kiro-cli', args: ['acp'], hint: 'Requires kiro-cli.' },
  { name: 'Kimi CLI', command: 'kimi', args: ['acp'], hint: 'Requires kimi.' },
  { name: 'Goose', command: 'goose', args: ['acp'], hint: 'Requires goose.' },
  { name: 'Pi', command: 'npx', args: ['-y', 'pi-acp'], hint: 'Run with npx; configure pi in a terminal first.' },
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
