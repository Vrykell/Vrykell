/**
 * dangerousCommands — table-driven danger heuristics for command-like input.
 *
 * A hit forces a per-call approval even when the tool level is "allow" or the user granted a
 * session approval for the tool. Reasons are i18n keys; the approval card renders the
 * translated text, so the table never carries user-visible copy itself.
 *
 * Rule sets:
 *   - INDIRECTION: hides the real command (interpreters, decoded payloads, remote loaders).
 *     Every shell evaluates these.
 *   - POSIX: POSIX shells, and every Windows shell as well — PowerShell aliases keep
 *     POSIX-shaped commands destructive (`rm -rf` is `Remove-Item -Recurse -Force`).
 *   - WINDOWS: Windows shells only, so a Windows-only string inside a POSIX command
 *     (a file name, say) cannot raise a false alarm.
 */
import { t, type I18nKey } from '@i18n';

type Rule = [RegExp, I18nKey];

/** Interpreter, encoding and remote-loader indirection that hides the real command. */
const INDIRECTION_RULES: Rule[] = [
  [
    /\b(sh|bash|zsh|dash|ksh|fish|python3?|perl|ruby|node|deno|bun|php)\s+(-c|-e|--eval|--command)\b/,
    'Runs inline code through an interpreter',
  ],
  [/(^|[;&|(]\s*)eval\s+[^\s]/, 'Evaluates constructed shell code'],  [/\b(base64|gpg)\s+(-d|-D|--decode)\b/, 'Decodes an encoded payload'],
  [/\bcertutil\b[^|;&]*-(decode|urlcache|verifyctl)\b/i, 'Downloads or decodes content through certutil'],
  [/\bbitsadmin\b/i, 'Transfers files through bitsadmin'],
  [
    /\b(Invoke-Expression|Invoke-WebRequest|Invoke-RestMethod|DownloadString|DownloadFile|Start-BitsTransfer|\biex\b)\b/i,
    'Loads or runs remote content',
  ],
  [/(-enc|-encodedcommand)\s+[A-Za-z0-9+/=]{16,}/i, 'PowerShell encoded command'],
];

/** POSIX commands (and their PowerShell aliases). */
const POSIX_RULES: Rule[] = [
  // 更具体的规则在前（curl|sudo bash 应报「管道执行」而非「sudo」）
  [/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|fi)?sh\b/, 'Downloads and pipes a remote script into a shell'],
  [/\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s|--(recursive|force)\b)/, 'Recursive or forced file deletion'],
  [/(^|[;&|(]\s*)sudo\b/, 'Privilege escalation with sudo'],
  [/\b(dd|mkfs|fdisk|diskutil)\s/, 'Disk-level operation'],
  [/\bgit\s+push\b[^&|;]*(\s-f\b|--force)/, 'Force push overwrites remote history'],
  [/\bgit\s+(reset\s+--hard|clean\s+-[a-zA-Z]*f)/, 'Discards working tree changes'],
  [/\b(pkill|killall)\b/, 'Kills processes by name'],
  [/\bkill\s+-(9|KILL)\b/, 'SIGKILL leaves no chance to clean up'],
  [/(^|[;&|(]\s*)(shutdown|reboot|halt|poweroff)\b/, 'Shuts down or reboots the system'],
  [/\bchmod\s+(-[a-zA-Z]*R[a-zA-Z]*\s+)?777\b/, 'Grants everyone read, write and execute access'],
  [/>\s*\/dev\/(sd|nvme|disk)/, 'Writes directly to a disk device'],
  [/:\(\)\s*\{.*\|.*&.*\}\s*;?\s*:/, 'Fork bomb'],
];

/** Windows shells only (cmd.exe and PowerShell cmdlets / WMIC paths). */
const WINDOWS_RULES: Rule[] = [
  [/\bRemove-Item\b[^|;&]*-(Recurse|Force)\b/i, 'PowerShell deletes files or directories recursively'],
  [/\b(rd|rmdir)\s+\/[a-z]*[sq]/i, 'Recursively deletes directories (cmd)'],
  [/\bdel\s+\/[a-z]*[sqf]/i, 'Force-deletes files (cmd)'],
  [/\bformat\s+[a-z]:/i, 'Formats a disk or partition'],
  [/\bdiskpart\b/i, 'Partitions or wipes disks'],
  [/\b(vssadmin|wbadmin)\b[^|;&]*\bdelete\b/i, 'Deletes backups or system snapshots'],
  [/\bbcdedit\b/i, 'Changes boot configuration'],
  [/\bcipher\s+\/w/i, 'Wipes free space on a volume'],
  [/\b(Stop-Computer|Restart-Computer)\b/i, 'Shuts down or restarts the computer'],
  [/\breg\s+delete\b/i, 'Deletes registry keys'],
  [/\bnet\s+(user|localgroup)\b/i, 'Changes local accounts or groups'],
  [/\b(icacls|takeown)\b/i, 'Rewrites file permissions or ownership'],
  [/\bSet-ExecutionPolicy\b/i, 'Changes the script execution policy'],
  [/\b(sc|schtasks)\s+(\/delete|delete)\b/i, 'Deletes a service or scheduled task'],
  [/\btaskkill\b[^|;&]*\/f\b/i, 'Force-kills processes'],
  [/\bwevtutil\b[^|;&]*\bcl\b/i, 'Clears system event logs'],
  [/\bnetsh\s+(advfirewall|firewall)\b/i, 'Changes the firewall configuration'],
];

const WINDOWS_SHELLS = new Set(['powershell', 'pwsh', 'cmd']);

/** True for shells whose commands are Windows-shaped (also used by the terminal tools). */
export function isWindowsShell(shellType?: string | null): boolean {
  const shell = shellType?.trim().toLowerCase();
  return !!shell && WINDOWS_SHELLS.has(shell);
}

/**
 * 命中返回展示原因（审批卡展示），未命中返回 null。
 * 不传 shellType（远程 SSH、未知 shell）时按 POSIX 规则判定。
 */
export function dangerousCommandReason(command: string, shellType?: string | null): string | null {
  const rules = isWindowsShell(shellType)
    ? [...INDIRECTION_RULES, ...POSIX_RULES, ...WINDOWS_RULES]
    : [...INDIRECTION_RULES, ...POSIX_RULES];
  for (const [re, key] of rules) {
    if (re.test(command)) return t(key);
  }
  return null;
}
