import type { SshLogEntry } from '@core/ssh';
import { redactText } from '@platform/diagnostics';

/** Sequences the client draws with (colors, cursor moves, window titles): the log keeps plain text only. */
const CONTROL_SEQUENCES = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-Z\\-_]/g;

/** Bounded history kept for the status panel. */
const LOG_LIMIT = 60;

/** Real connection lines from one chunk of terminal output. */
export function connectionLogLines(text: string): string[] {
  return text.slice(-65536)
    .replace(CONTROL_SEQUENCES, '')
    .split(/\r?\n/)
    .map(line => redactText(line.trim()).slice(0, 1024))
    .filter(line => line.length > 0);
}

/** Messages the client prints by itself, including when an established session drops. */
const CLIENT_NOTICES = /^(ssh:|Warning:|Connection (closed|reset|timed out)|Connection to .+ closed|Received disconnect|Timeout, server|kex_exchange_identification|Host key verification failed|Permission denied|Too many authentication failures|Authentication failed|Unable to negotiate|no matching host key)/;

/** Only client notices are retained, even when the shell has no integration markers. */
export function isSshClientNotice(line: string): boolean {
  return CLIENT_NOTICES.test(line);
}

/** Append in arrival order, drop repeated redraws of the same line and keep the history bounded. */
export function appendLogEntry(entries: SshLogEntry[], entry: SshLogEntry): SshLogEntry[] {
  if (entries[entries.length - 1]?.text === entry.text) return entries;
  return [...entries, entry].slice(-LOG_LIMIT);
}
