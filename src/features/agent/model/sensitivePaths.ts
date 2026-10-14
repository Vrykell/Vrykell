/**
 * sensitivePaths — table-driven heuristics for paths that hold credentials.
 *
 * The agent's file tools and command text are checked before execution: a hit forces a
 * per-call approval even when the tool level is "allow" or the user granted a session
 * approval. That is the guard against prompt injection talking the model into reading
 * ssh keys / API keys / .env files and shipping them to the provider. The heuristic is a
 * name check, not a content scan: it is deliberately cheap and errs towards asking.
 *
 * Reasons are i18n keys; the approval card renders the translated text.
 */
import { t, type I18nKey } from '@i18n';

type Check = [RegExp, I18nKey];

const CHECKS: Check[] = [
  // ── 密钥与凭据目录 ──
  [/(^|\/)\.ssh\//, 'SSH private key directory ~/.ssh'],
  [/(^|\/)\.aws\//, 'AWS credentials directory ~/.aws'],
  [/(^|\/)\.gnupg\//, 'GPG key directory ~/.gnupg'],
  [/(^|\/)\.kube\//, 'Kubernetes credentials ~/.kube'],
  [/(^|\/)\.config\/gcloud\//, 'Google Cloud credentials'],
  [/(^|\/)\.docker\/config\.json$/, 'Docker registry credentials'],
  // ── 私钥文件（按文件名；公开证书 *.pem 不在此列，避免每次读证书都要确认） ──
  [/(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/, 'Private key file'],
  [/\.(p12|pfx|kdbx)$/i, 'Key store file'],
  // ── 凭据文件 ──
  [/(^|\/)\.git-credentials$/, 'Git credentials file'],
  [/(^|\/)\.netrc$/, 'Network credentials file'],
  [/(^|\/)\.npmrc$/, 'npm credentials file'],
  [/(^|\/)\.pypirc$/, 'Python package index credentials'],
  [/(^|\/)credentials\.json$/, 'Service account credentials'],
  // ── 环境变量与应用配置 ──
  [/(^|\/)\.env($|\.)/, 'Environment file (may hold secrets)'],
  [/(^|\/)\.vrykell\/(config|secrets)\.json$/, 'Application configuration (may hold API keys)'],
  // ── 系统账户文件 ──
  [/\/etc\/(shadow|passwd)\b/, 'System account file'],
];

/** 路径命中敏感规则时返回原因；否则 null。兼容 ~ 与绝对路径写法。 */
export function sensitivePathReason(path: string): string | null {
  const p = path.trim();
  if (!p) return null;
  const norm = p.startsWith('~/') ? `~${p.slice(1)}` : p;
  for (const [re, key] of CHECKS) {
    if (re.test(norm)) return t(key);
  }
  return null;
}
