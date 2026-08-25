/**
 * dangerousCommands — 危险命令启发式（表驱动；命中即逐次询问，无视任何授权）。
 */

// ── 危险命令启发式（表驱动；命中即逐次询问，无视任何授权） ──

const DANGEROUS: Array<[RegExp, string]> = [
  // 更具体的规则在前（curl|sudo bash 应报「管道执行」而非「sudo」）
  [/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|fi)?sh\b/, '下载并管道执行远程脚本'],
  [/\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s|--(recursive|force)\b)/, '递归/强制删除文件'],
  [/\bsudo\b/, 'sudo 提权操作'],
  [/\b(dd|mkfs|fdisk|diskutil)\s/, '磁盘级操作'],
  [/\bgit\s+push\b[^&|;]*(\s-f\b|--force)/, 'git 强制推送（会覆盖远端历史）'],
  [/\bgit\s+(reset\s+--hard|clean\s+-[a-zA-Z]*f)/, 'git 丢弃工作区改动（不可恢复）'],
  [/\b(pkill|killall)\b/, '按名字批量杀进程（可能误伤同名进程）'],
  [/\bkill\s+-(9|KILL)\b/, '强杀进程（SIGKILL，进程无清理机会）'],
  [/\b(shutdown|reboot|halt|poweroff)\b/, '关机/重启系统'],
  [/\bchmod\s+(-[a-zA-Z]*R[a-zA-Z]*\s+)?777\b/, '放开全员读写执行权限'],
  [/>\s*\/dev\/(sd|nvme|disk)/, '直写磁盘设备'],
  [/:\(\)\s*\{.*\|.*&.*\}\s*;?\s*:/, 'fork 炸弹'],
];

/** 命中返回中文原因（审批卡展示），未命中返回 null */
export function dangerousCommandReason(command: string): string | null {
  for (const [re, reason] of DANGEROUS) {
    if (re.test(command)) return reason;
  }
  return null;
}
