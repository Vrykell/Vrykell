/**
 * 后端契约类型（Rust 返回/入参结构）的唯一权威定义。
 *
 * 这些类型描述的是 Tauri `invoke` 跨进程边界的原始数据形状，属于基础设施契约，
 * 与任何具体 feature 的领域模型无关，因此收敛到 `@platform/api`，供 API 封装层
 * 与各业务域共同引用，避免 features 反向持有基础设施类型。
 */

// ── 本地文件系统 ──
/** Rust fs_list 返回的目录条目（path 由 @platform/api/fs 归一化后交给业务层） */
export interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

/** Rust fs_disks 返回的磁盘条目（「此电脑」视图小卡片展示用） */
export interface DiskEntry {
  name: string;
  path: string;
  total_bytes: number;
  free_bytes: number;
}

// ── 历史命令 ──
export interface BackendHistoryEntry {
  id: number;
  command: string;
  cwd: string;
  exit_code: number | null;
  timestamp: number;
  run_count: number;
}

// ── 文件搜索匹配 ──
export interface BackendFileMatch {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number;
  match_type: string;
  content_snippet: string | null;
}

// ── 搜索上下文 ──
export interface BackendSearchContext {
  cwd: string;
  home: string;
  shell: string;
  git_branch: string | null;
  project_name: string | null;
}

/** Rust blocks 表 JOIN sessions 返回 */
export interface BackendBlockEntry {
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

/** Rust sessions 表返回 */
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
  /** 会话类型判别：local | ssh */
  kind: string;
  /** 变体专属数据的 JSON 字符串 */
  payload: string;
}

/** Rust groups 表返回 */
export interface BackendGroupEntry {
  id: string;
  title: string;
  sort_order: number;
  collapsed: boolean;
  created_at: number;
  session_count: number;
  archived: boolean;
}

/** Rust workspaces 表返回 */
export interface BackendWorkspaceEntry {
  id: number;
  path: string;
  name: string;
  added_at: number;
}

/** Rust chat_messages 表返回 */
export interface BackendChatMessage {
  id: string;
  role: string;
  content: string;
  created_at: number;
  /** 消息 parts 渲染层 JSON（'' = 无/旧数据，见 agent/messageParts.ts） */
  parts: string;
  /** 附件元数据 JSON（M5，'' = 无/旧数据，见 agent/attachments.ts） */
  attachments: string;
}
