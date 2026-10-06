/**
 * terminalOpenPage — 各 Shell 打开模式设置页。
 */
import Select from '@ui/Select';
import { useAgentSettings } from '@features/agent';
import type { ShellType } from '@platform/shells';
import { Field } from '@features/settings/components/ui';
import { useSettingsSave } from '../components/SettingsSaveProvider';

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
  const { save } = useSettingsSave();
  const setShellMode = (shell: ShellType, mode: 'classic' | 'block') =>
    save(() => agentSettings.update({ openModeByShell: { ...openModeByShell, [shell]: mode } }));
  const setSshMode = (mode: 'classic' | 'block') =>
    save(() => agentSettings.update({ sshOpenMode: mode }));

  return (
    <>
      <Field title="各 Shell 打开模式" description="经典模式输出直进终端；块模式生成命令块。">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(Object.keys(SHELL_LABELS) as ShellType[]).map((shell) => (
            <div key={shell} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 110, fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-primary)' }}>
                {SHELL_LABELS[shell]}
              </span>
              <Select
                aria-label={`${SHELL_LABELS[shell]} 打开模式`}
                options={shell === 'cmd' ? OPEN_MODE_OPTIONS.filter(option => option.value === 'classic') : OPEN_MODE_OPTIONS}
                value={shell === 'cmd' ? 'classic' : openModeByShell[shell]}
                onChange={(v) => setShellMode(shell, v)}
              />
              {shell === 'cmd' && <span style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)' }}>使用经典模式</span>}
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 110, fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-primary)' }}>SSH</span>
            <Select
              aria-label="SSH 打开模式"
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
