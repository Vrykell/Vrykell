/**
 * sensitivePaths — 敏感路径启发式（表驱动）。
 *
 * agent 的文件工具（read_file/write_file/edit_file）命中敏感路径时，
 * 即使权限为 allow/放行也强制逐次询问（复用 gate 的 danger 机制）——
 * 防止提示注入诱导 agent 读取密钥（SSH 私钥 / API key / .env）后，
 * 把内容随对话上下文发给 LLM 供应商。
 */

const CHECKS: [RegExp, string][] = [
  [/(^|\/)\.ssh\//, 'SSH 私钥目录 ~/.ssh'],
  [/(^|\/)\.aws\//, 'AWS 凭据目录 ~/.aws'],
  [/(^|\/)\.gnupg\//, 'GPG 密钥目录 ~/.gnupg'],
  [/(^|\/)\.git-credentials$/, 'Git 凭据文件'],
  [/(^|\/)\.netrc$/, '网络凭据文件'],
  [/(^|\/)\.npmrc$/, 'npm 凭据文件'],
  [/(^|\/)\.pypirc$/, 'Python 包索引凭据'],
  [/(^|\/)\.env($|\.)/, '环境变量文件（.env 可能含密钥）'],
  [/(^|\/)\.vrykell\/(config|secrets)\.json$/, 'Vrykell 应用配置（可能含 API key）'],
  [/^\/etc\/(shadow|passwd)$/, '系统账户文件'],
];

/** 路径命中敏感规则时返回原因；否则 null。兼容 ~ 与绝对路径写法。 */
export function sensitivePathReason(path: string): string | null {
  const p = path.trim();
  if (!p) return null;
  const norm = p.startsWith('~/') ? `~${p.slice(1)}` : p;
  for (const [re, reason] of CHECKS) {
    if (re.test(norm)) return reason;
  }
  return null;
}
