/**
 * Backend contract types (Rust response/argument shapes) — the single authoritative definition.
 *
 * These describe the raw data shape across the IPC boundary of the invoke layer. They are
 * infrastructure contracts, independent of any feature's domain model, so they live in
 * `@platform/api` and are shared by the API wrappers and the feature domains, which keeps
 * features from reaching into infrastructure types.
 */

// ── Local filesystem ──
/** Directory entry returned by the backend fs_list (its path is normalized by @platform/api/fs before reaching feature code). */
export interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_symlink?: boolean;
}

/** Disk entry returned by the backend fs_disks (small cards in the drives view). */
export interface DiskEntry {
  name: string;
  path: string;
  total_bytes: number;
  free_bytes: number;
}

/** Single-path metadata from fs_stat / ssh_stat (path bar detection and properties dialog). */
export interface FileStat {
  name: string;
  path: string;
  is_dir: boolean;
  is_symlink: boolean;
  size: number;
  /** Unix milliseconds; null when the platform or protocol cannot provide it (SFTP has no creation time). */
  created_ms: number | null;
  modified_ms: number | null;
}

// ── Command history ──
export interface BackendHistoryEntry {
  id: number;
  command: string;
  cwd: string;
  exit_code: number | null;
  timestamp: number;
  run_count: number;
}

// ── File search matches ──
export interface BackendFileMatch {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number;
  match_type: string;
  content_snippet: string | null;
}

/** Returned by the backend block query joined with sessions. */
export interface BackendBlockEntry {
  /** Absent on older backend responses. */
  cwd?: string;
  id: string;
  session_id: string;
  pane_id: string | null;
  command: string;
  output_raw: string;
  output_clean: string;
  output_html: string;
  exit_code: number | null;
  status: string;
  started_at: number;
  ended_at: number | null;
  session_title: string;
  session_status: string;
}

/** Returned by the backend sessions table. */
export interface BackendSessionEntry {
  id: string;
  title: string;
  status: string;
  created_at: number;
  closed_at: number | null;
  block_count: number;
  cwd: string;
  group_id: string | null;
  sort_order: number;
  /** Session kind discriminator: local | ssh. */
  kind: string;
  /** Variant-specific JSON payload. */
  payload: string;
}

/** Returned by the backend groups table. */
export interface BackendGroupEntry {
  id: string;
  title: string;
  sort_order: number;
  collapsed: boolean;
  created_at: number;
  session_count: number;
  archived: boolean;
}

/** Returned by the backend workspaces table. */
export interface BackendWorkspaceEntry {
  id: number;
  path: string;
  name: string;
  added_at: number;
}

/** Returned by the backend chat_messages table. */
export interface BackendChatMessage {
  pane_id?: string | null;
  id: string;
  role: string;
  content: string;
  created_at: number;
  /** Message parts JSON for the render layer ('' = none/legacy data, see agent/messageParts.ts). */
  parts: string;
  /** Attachment metadata JSON ('' = none/legacy data, see agent/attachments.ts). */
  attachments: string;
}
