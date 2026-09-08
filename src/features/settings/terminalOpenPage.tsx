/**
 * terminalOpenPage — 各 Shell 打开模式设置页。
 */

import Segmented from '@/components/ui/Segmented/Segmented';
import { useAgentSettings } from '@/features/agent/agentSettings';
import { Field } from '@/features/settings/ui';
import type { ShellType } from '@/services/tauri/shells';

const OPEN_MODE_OPTIONS = (
  [
    ['classic', '经典模式'],
    ['block', '块模式'],
  ] as const
).map(([value, label]) => ({ value, label }));

const SHELL_LABELS: Record<ShellType, string> = {
  zsh: 'Zsh',
  bash: 'Bash',
  powershell: 'PowerShell',
  pwsh: 'PowerShell',
  cmd: 'CMD',
};

export function TerminalOpenPage() {
  const agentSettings = useAgentSettings();
  const openModeByShell = agentSettings.global.openModeByShell;
  const sshOpenMode = agentSettings.global.sshOpenMode;
  const setShellMode = (shell: ShellType, mode: 'classic' | 'block') =>
    agentSettings.update({ openModeByShell: { ...openModeByShell, [shell]: mode } });
  const setSshMode = (mode: 'classic' | 'block') => agentSettings.update({ sshOpenMode: mode });

  return (
    <>
      <Field title="各 Shell 打开模式" description="经典模式输出直进终端；块模式生成命令块。">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(Object.keys(SHELL_LABELS) as ShellType[]).map((shell) => (
            <div key={shell} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 110, fontSize: 12, color: 'var(--text-primary)' }}>
                {SHELL_LABELS[shell]}
              </span>
              <Segmented
                size="sm"
                options={OPEN_MODE_OPTIONS}
                value={openModeByShell[shell]}
                onChange={(v) => setShellMode(shell, v)}
              />
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 110, fontSize: 12, color: 'var(--text-primary)' }}>SSH</span>
            <Segmented
              size="sm"
              options={OPEN_MODE_OPTIONS}
              value={sshOpenMode}
              onChange={setSshMode}
            />
          </div>
        </div>
      </Field>
    </>
  );
}
