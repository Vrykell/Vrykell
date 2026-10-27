/**
 * skills — folder-based skills (aligned with the Agent Skills open specification).
 *
 * Each skill is a directory on disk (`~/.vrykell/skills/<name>/`) containing `SKILL.md`
 * (frontmatter: name/description/allowed-tools plus the body) and optional
 * scripts/references/assets. The backend owns the index (source/trust/enabled/content hash); this
 * module only provides types and invoke wrappers.
 */

import { invoke } from '@platform/diagnostics';

/** Skill metadata (returned by list_skills, without the body). */
export interface SkillMeta {
  name: string;
  description: string;
  dir: string;
  files: string[];
  hasScripts: boolean;
  allowedTools: string;
  source: string;
  trusted: boolean;
  enabled: boolean;
  modified: boolean;
}

/** Skill detail (returned by get_skill, including the body). */
export interface SkillDetail extends SkillMeta {
  prompt: string;
}

/** One entry in a remote skill registry (the vrykell-skills/v1 protocol). */
export interface RemoteSkill {
  name: string;
  description: string;
  prompt: string;
  version?: string;
  author?: string;
}

/** Skill trust information (returned by find_skill_reference). */
export interface SkillTrustInfo {
  name: string;
  trusted: boolean;
  enabled: boolean;
}

/** Remote repository marketplace search result. */
export interface MarketSkill {
  name: string;
  description: string;
  /** Path of the skill directory relative to the repository. */
  dir: string;
}

export const listSkills = () => invoke<SkillMeta[]>('list_skills');
export const getSkill = (name: string) => invoke<SkillDetail>('get_skill', { name });
export const setSkillState = (name: string, trusted?: boolean, enabled?: boolean) =>
  invoke<void>('set_skill_state', { name, trusted: trusted ?? null, enabled: enabled ?? null });
export const readSkillFile = (name: string, relativePath: string) =>
  invoke<string>('read_skill_file', { name, relativePath });
export const removeSkill = (name: string) => invoke<void>('remove_skill', { name });
export const installSkillMd = (name: string, description: string, prompt: string, lease?: string | null) =>
  invoke<SkillMeta>('install_skill_md', { name, description, prompt, ...(lease === undefined ? {} : { lease }) });
export const importSkillsFromPath = (path: string) =>
  invoke<SkillMeta[]>('import_skills_from_path', { path });
export const fetchRemoteSkills = (url: string) =>
  invoke<RemoteSkill[]>('fetch_skill_registry', { url });
export const findSkillReference = (text: string) =>
  invoke<SkillTrustInfo | null>('find_skill_reference', { text });

/** Remote repository marketplace: list the skills inside a repository. */
export const marketGithubList = (repo: string) => invoke<MarketSkill[]>('market_github_list', { repo });
/** Remote repository marketplace: install a skill from one directory in a repository. */
export const marketGithubInstall = (repo: string, dir: string) =>
  invoke<SkillMeta>('market_github_install', { repo, dir });

/** If the text or path references an untrusted skill, return its name; otherwise null. */
export async function untrustedSkillFor(text: string): Promise<string | null> {
  try {
    const info = await findSkillReference(text);
    if (info && !info.trusted) return info.name;
  } catch {
    /* Ignore a failed lookup and allow. */
  }
  return null;
}

/** Skills that can be injected into the agent context: enabled + trusted. */
export function availableSkillMetas(metas: SkillMeta[]): SkillMeta[] {
  return metas.filter((m) => m.enabled && m.trusted);
}

/** "Available skills" list injected into the system prompt (names + descriptions only). */
export function buildSkillsContext(metas: SkillMeta[]): string {
  if (metas.length === 0) return '';
  const lines = metas.map(k => `- ${k.name}: ${k.description || 'No description'}`);
  return [
    'Available skills: load matching instructions with use_skill. Read or run resources through read_file and run_command within the granted permissions.',
    ...lines,
  ].join('\n');
}
