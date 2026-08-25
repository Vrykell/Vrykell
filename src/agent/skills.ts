/**
 * skills — 用户自定义「技能」（主流 agent 编码工具与 Cherry Studio 的 Agent Skills 式设计）。
 *
 * 每个技能 = 名称 + 一句话描述（何时用）+ 完整提示词正文。启用后：
 *   1. 系统提示词里注入「可用技能清单」（仅名称 + 描述，省 token）；
 *   2. agent 用 use_skill 工具按名加载某技能的完整 prompt 再照做（按需加载）。
 *
 * 获取方式：内置标准技能 + 本地编辑 + 通过统一协议从网络导入技能清单。
 * localStorage 持久化；技能是全局能力（不按模型覆盖）。
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import { STANDARD_SKILLS } from './standardSkills';

export interface Skill {
  id: string;
  /** 技能名（use_skill 按名调用，须唯一且非空） */
  name: string;
  /** 一句话描述：何时该用这个技能（会出现在系统提示词的清单里） */
  description: string;
  /** 完整提示词正文（use_skill 加载后返回给模型） */
  prompt: string;
  enabled: boolean;
}

/** 网络技能清单里的单条（统一协议 vrykell-skills/v1）。 */
export interface RemoteSkill {
  name: string;
  description: string;
  prompt: string;
  version?: string;
  author?: string;
}

interface SkillsState {
  skills: Skill[];
  /** 新增一条空技能，返回其 id */
  add: () => string;
  update: (id: string, patch: Partial<Skill>) => void;
  remove: (id: string) => void;
  toggle: (id: string) => void;
  /** 安装/更新一条技能（按名去重：同名则覆盖描述与正文） */
  install: (skill: { name: string; description: string; prompt: string }) => void;
}

function newId(): string {
  return `sk${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function cloneStandard(): Skill[] {
  return STANDARD_SKILLS.map((s) => ({ ...s }));
}

export const useSkills = create<SkillsState>()(
  persist(
    (set) => ({
      skills: cloneStandard(),
      add: () => {
        const id = newId();
        set((s) => ({
          skills: [...s.skills, { id, name: '', description: '', prompt: '', enabled: true }],
        }));
        return id;
      },
      update: (id, patch) =>
        set((s) => ({
          skills: s.skills.map((k) => (k.id === id ? { ...k, ...patch } : k)),
        })),
      remove: (id) => set((s) => ({ skills: s.skills.filter((k) => k.id !== id) })),
      toggle: (id) =>
        set((s) => ({
          skills: s.skills.map((k) => (k.id === id ? { ...k, enabled: !k.enabled } : k)),
        })),
      install: (skill) => {
        const key = skill.name.trim().toLowerCase();
        set((s) => {
          const idx = s.skills.findIndex((k) => k.name.trim().toLowerCase() === key);
          if (idx >= 0) {
            return {
              skills: s.skills.map((k, i) =>
                i === idx
                  ? { ...k, description: skill.description || k.description, prompt: skill.prompt || k.prompt }
                  : k,
              ),
            };
          }
          return {
            skills: [
              ...s.skills,
              {
                id: newId(),
                name: skill.name.trim(),
                description: skill.description,
                prompt: skill.prompt,
                enabled: true,
              },
            ],
          };
        });
      },
    }),
    {
      name: 'vrykell-skills',
      version: 2,
      migrate: (persisted) => {
        const p = (persisted ?? {}) as { skills?: Skill[] };
        if (!Array.isArray(p.skills) || p.skills.length === 0) {
          return { skills: cloneStandard() };
        }
        return p as { skills: Skill[] };
      },
    },
  ),
);

/** 已启用且有名字的技能（供清单与 use_skill 检索）。 */
export function enabledSkills(): Skill[] {
  return useSkills.getState().skills.filter((k) => k.enabled && k.name.trim().length > 0);
}

/** 按名或 id 找一条已启用技能。 */
export function findSkill(nameOrId: string): Skill | undefined {
  const q = nameOrId.trim().toLowerCase();
  return useSkills
    .getState()
    .skills.find(
      (k) => k.enabled && (k.name.trim().toLowerCase() === q || k.id === nameOrId.trim()),
    );
}

/** 注入系统提示词的「可用技能清单」（仅名称 + 描述）。无技能返回空串。 */
export function buildSkillsContext(): string {
  const list = enabledSkills();
  if (list.length === 0) return '';
  const lines = list.map((k) => `- ${k.name}：${k.description || '（无描述）'}`);
  return [
    '可用技能（当任务匹配某个技能时，用 use_skill 工具按名加载其完整指令后再执行）：',
    ...lines,
  ].join('\n');
}

/** 通过统一协议从网络获取技能清单（vrykell-skills/v1）。 */
export function fetchRemoteSkills(url: string): Promise<RemoteSkill[]> {
  return invoke<RemoteSkill[]>('fetch_skill_registry', { url });
}
