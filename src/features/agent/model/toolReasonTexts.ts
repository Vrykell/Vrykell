/**
 * toolReasonTexts — reason codes from the backend rendered as user-visible text.
 *
 * Rust decides (and shows its own native confirmation); the codes it returns are turned into
 * the catalog text here so the conversation keeps showing why a call was held back.
 */
import { t, type I18nKey } from '@i18n';

const REASON_KEYS: Record<string, I18nKey> = {
  'policy.denied': 'Denied by the permission settings',
  // Nobody was in front of the app, or nobody answered the system confirmation in time.
  'policy.unattended': 'The window was not in front, so the system confirmation was skipped',
  'policy.confirm_timeout': 'Nobody confirmed in time, so the call was denied',

  'danger.interpreter': 'Runs inline code through an interpreter',
  'danger.eval': 'Evaluates constructed shell code',
  'danger.decode': 'Decodes an encoded payload',
  'danger.certutil': 'Downloads or decodes content through certutil',
  'danger.bitsadmin': 'Transfers files through bitsadmin',
  'danger.remote_content': 'Loads or runs remote content',
  'danger.encoded_command': 'PowerShell encoded command',
  'danger.pipe_remote_script': 'Downloads and pipes a remote script into a shell',
  'danger.recursive_delete': 'Recursive or forced file deletion',
  'danger.sudo': 'Privilege escalation with sudo',
  'danger.disk_operation': 'Disk-level operation',
  'danger.force_push': 'Force push overwrites remote history',
  'danger.discard_changes': 'Discards working tree changes',
  'danger.kill_by_name': 'Kills processes by name',
  'danger.sigkill': 'SIGKILL leaves no chance to clean up',
  'danger.power': 'Shuts down or reboots the system',
  'danger.chmod_777': 'Grants everyone read, write and execute access',
  'danger.write_device': 'Writes directly to a disk device',
  'danger.fork_bomb': 'Fork bomb',
  'danger.ps_remove_item': 'PowerShell deletes files or directories recursively',
  'danger.rd_recursive': 'Recursively deletes directories (cmd)',
  'danger.del_forced': 'Force-deletes files (cmd)',
  'danger.format': 'Formats a disk or partition',
  'danger.diskpart': 'Partitions or wipes disks',
  'danger.delete_backups': 'Deletes backups or system snapshots',
  'danger.boot_config': 'Changes boot configuration',
  'danger.wipe_free_space': 'Wipes free space on a volume',
  'danger.power_windows': 'Shuts down or restarts the computer',
  'danger.reg_delete': 'Deletes registry keys',
  'danger.accounts': 'Changes local accounts or groups',
  'danger.acl': 'Rewrites file permissions or ownership',
  'danger.execution_policy': 'Changes the script execution policy',
  'danger.delete_service': 'Deletes a service or scheduled task',
  'danger.taskkill': 'Force-kills processes',
  'danger.clear_logs': 'Clears system event logs',
  'danger.firewall': 'Changes the firewall configuration',

  'path.ssh_dir': 'SSH private key directory ~/.ssh',
  'path.aws_dir': 'AWS credentials directory ~/.aws',
  'path.gnupg_dir': 'GPG key directory ~/.gnupg',
  'path.kube_dir': 'Kubernetes credentials ~/.kube',
  'path.gcloud_dir': 'Google Cloud credentials',
  'path.docker_credentials': 'Docker registry credentials',
  'path.private_key': 'Private key file',
  'path.key_store': 'Key store file',
  'path.git_credentials': 'Git credentials file',
  'path.netrc': 'Network credentials file',
  'path.npmrc': 'npm credentials file',
  'path.pypirc': 'Python package index credentials',
  'path.service_account': 'Service account credentials',
  'path.env_file': 'Environment file (may hold secrets)',
  'path.app_config': 'Application configuration (may hold API keys)',
  'path.system_accounts': 'System account file',

  'durable.memory_rewrite': 'Updates a durable memory fact used by future retrieval',
  'durable.memory_append': 'Adds a durable memory fact used by future retrieval',
};

/** Localized text for a reason code; unknown codes are shown as-is (never swallowed). */
export function reasonText(code: string | undefined | null): string | undefined {
  if (!code) return undefined;
  const key = REASON_KEYS[code];
  return key ? t(key) : code;
}
