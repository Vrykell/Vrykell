/**
 * skills — 文件夹式技能（对齐 Agent Skills 开放规范）。
 *
 * 每个技能是一个磁盘目录（`~/.vrykell/skills/<name>/`），含 `SKILL.md`
 * （frontmatter：name/description/allowed-tools + 正文）+ 可选 scripts/references/assets。
 * 索引（来源/信任/启停/内容哈希）由 Rust 持有，本模块只做类型 + invoke 封装。
 */

import { invoke } from '@tauri-apps/api/core';

/** 技能元信息（list_skills 返回，不含正文）。 */
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

/** 技能详情（get_skill 返回，含正文）。 */
export interface SkillDetail extends SkillMeta {
  prompt: string;
}

/** 网络技能清单里的单条（统一协议 vrykell-skills/v1）。 */
export interface RemoteSkill {
  name: string;
  description: string;
  prompt: string;
  version?: string;
  author?: string;
}

/** 技能信任信息（find_skill_reference 返回）。 */
export interface SkillTrustInfo {
  name: string;
  trusted: boolean;
  enabled: boolean;
}

/** GitHub 市场搜索结果。 */
export interface MarketSkill {
  name: string;
  description: string;
  /** 仓库内技能目录相对路径 */
  dir: string;
}

export const listSkills = () => invoke<SkillMeta[]>('list_skills');
export const getSkill = (name: string) => invoke<SkillDetail>('get_skill', { name });
export const setSkillState = (name: string, trusted?: boolean, enabled?: boolean) =>
  invoke<void>('set_skill_state', { name, trusted: trusted ?? null, enabled: enabled ?? null });
export const readSkillFile = (name: string, relativePath: string) =>
  invoke<string>('read_skill_file', { name, relativePath });
export const removeSkill = (name: string) => invoke<void>('remove_skill', { name });
export const installSkillMd = (name: string, description: string, prompt: string) =>
  invoke<SkillMeta>('install_skill_md', { name, description, prompt });
export const importSkillsFromPath = (path: string) =>
  invoke<SkillMeta[]>('import_skills_from_path', { path });
export const fetchRemoteSkills = (url: string) =>
  invoke<RemoteSkill[]>('fetch_skill_registry', { url });
export const findSkillReference = (text: string) =>
  invoke<SkillTrustInfo | null>('find_skill_reference', { text });

/** GitHub 市场：列出仓库内的技能。 */
export const marketGithubList = (repo: string) =>
  invoke<MarketSkill[]>('market_github_list', { repo });
/** GitHub 市场：安装仓库内某目录的技能。 */
export const marketGithubInstall = (repo: string, dir: string) =>
  invoke<SkillMeta>('market_github_install', { repo, dir });

/** 若文本/路径引用的是未信任技能，返回其名称；否则 null。 */
export async function untrustedSkillFor(text: string): Promise<string | null> {
  try {
    const info = await findSkillReference(text);
    if (info && !info.trusted) return info.name;
  } catch {
    /* 忽略查询失败，放行 */
  }
  return null;
}

/** 可注入 agent 上下文的技能：已启用 + 已信任。 */
export function availableSkillMetas(metas: SkillMeta[]): SkillMeta[] {
  return metas.filter((m) => m.enabled && m.trusted);
}

/** 注入系统提示词的「可用技能清单」（仅名称 + 描述）。 */
export function buildSkillsContext(metas: SkillMeta[]): string {
  if (metas.length === 0) return '';
  const lines = metas.map((k) => `- ${k.name}：${k.description || '无描述'}`);
  return [
    '可用技能（当任务匹配某个技能时，用 use_skill 工具按名加载其完整指令，技能目录里的脚本/参考文件可用 read_file / run_command 读取运行）：',
    ...lines,
  ].join('\n');
}
