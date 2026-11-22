import { t } from '@i18n';
import type { HarnessConfig } from '@platform/api/acp';

/** A configured instance is identified by its driver and configuration, never its display label. */
export type AgentInstance = { driver: 'builtin' } | { driver: 'acp'; name: string };
export const builtInAgent = { driver: 'builtin' } as const;

export interface AgentEntry {
  id: string;
  instance: AgentInstance;
  label: string;
  detail: string;
  command?: string;
  enabled: boolean;
}

export function agentCatalog(configs: readonly HarnessConfig[], activeModel?: string): AgentEntry[] {
  return [
    {
      id: 'builtin',
      instance: builtInAgent,
      label: t('Built-in agent'),
      detail: activeModel || t('Chat with your configured models'),
      enabled: true,
    },
    ...configs.map((config) => ({
      id: `acp:${config.name}`,
      instance: { driver: 'acp' as const, name: config.name },
      label: config.name,
      detail: [config.command, ...config.args].join(' '),
      command: config.command.trim(),
      enabled: config.enabled,
    })),
  ];
}
