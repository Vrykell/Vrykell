use crate::db::{HistoryState, SshConnection};
use serde::{Deserialize, Serialize};
use std::{io::Read, path::Path, process::Stdio, time::Duration};

const MAX_CONTENT: usize = 2 * 1024 * 1024;
const MAX_STATUS: usize = 8 * 1024 * 1024;
mod references;
pub use references::{GitReference, GitReferenceAction};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitTarget {
    cwd: String,
    connection_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitEntry {
    path: String,
    previous_path: Option<String>,
    index_status: String,
    worktree_status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSnapshot {
    root: String,
    branch: String,
    entries: Vec<GitEntry>,
    upstream: Option<String>,
    ahead: usize,
    behind: usize,
    remotes: Vec<String>,
    detached: bool,
    has_head: bool,
    operation: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GitOperation {
    StageAll,
    UnstageAll,
    Commit,
    Fetch,
    Pull,
    Push,
    Sync,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GitScope {
    Unstaged,
    Staged,
    Untracked,
    Conflicts,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GitAction {
    Stage,
    Unstage,
    Discard,
    Resolve,
}

#[derive(Serialize)]
pub struct GitDiff {
    original: String,
    modified: String,
    kind: &'static str,
}

#[derive(Default, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktree {
    path: String,
    head: String,
    branch: Option<String>,
    detached: bool,
    bare: bool,
    locked: Option<String>,
    prunable: Option<String>,
}

fn parse_worktrees(bytes: &[u8]) -> Result<Vec<GitWorktree>, String> {
    let text = std::str::from_utf8(bytes).map_err(|_| "Worktree metadata is not valid UTF-8")?;
    let mut trees = Vec::new();
    let mut current: Option<GitWorktree> = None;
    for field in text.split('\0') {
        let (key, value) = field.split_once(' ').unwrap_or((field, ""));
        if key == "worktree" {
            if let Some(tree) = current.take() {
                trees.push(tree);
            }
            current = Some(GitWorktree {
                path: value.into(),
                ..Default::default()
            });
        } else if let Some(tree) = current.as_mut() {
            match key {
                "HEAD" => tree.head = value.into(),
                "branch" => {
                    tree.branch = Some(value.strip_prefix("refs/heads/").unwrap_or(value).into())
                }
                "detached" => tree.detached = true,
                "bare" => tree.bare = true,
                "locked" => tree.locked = Some(value.into()),
                "prunable" => tree.prunable = Some(value.into()),
                _ => {}
            }
        }
    }
    if let Some(tree) = current {
        trees.push(tree);
    }
    Ok(trees)
}

struct Output {
    success: bool,
    bytes: Vec<u8>,
    error: Vec<u8>,
}
struct Runner {
    cwd: String,
    session: Option<ssh2::Session>,
}

fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

impl Runner {
    fn new(target: GitTarget, connection: Option<SshConnection>) -> Result<Self, String> {
        if target.cwd.contains('\0') || target.cwd.is_empty() {
            return Err("Invalid repository directory".into());
        }
        let session = connection
            .as_ref()
            .map(|connection| {
                crate::remote::ssh::connect_with_timeout(connection, Some(Duration::from_secs(5)))
            })
            .transpose()?;
        if let Some(session) = &session {
            if !target.cwd.starts_with('/') {
                return Err("The repository directory must be absolute".into());
            }
            session.set_timeout(10_000);
        } else if !Path::new(&target.cwd).is_absolute() {
            return Err("The repository directory must be absolute".into());
        }
        Ok(Self {
            cwd: target.cwd,
            session,
        })
    }

    fn run(&self, args: &[&str], limit: usize) -> Result<Output, String> {
        if let Some(session) = &self.session {
            session.set_timeout(operation_timeout(args).as_millis() as u32);
            let mut channel = session
                .channel_session()
                .map_err(|error| error.to_string())?;
            channel
                .handle_extended_data(ssh2::ExtendedData::Merge)
                .map_err(|error| error.to_string())?;
            let command = format!("cd {} && LC_ALL=C GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0 GIT_EDITOR=true GIT_MERGE_AUTOEDIT=no git --no-pager --literal-pathspecs {}", quote(&self.cwd), args.iter().map(|arg| quote(arg)).collect::<Vec<_>>().join(" "));
            channel.exec(&command).map_err(|error| error.to_string())?;
            channel.send_eof().map_err(|error| error.to_string())?;
            let mut bytes = Vec::new();
            (&mut channel)
                .take(limit as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|error| error.to_string())?;
            if bytes.len() > limit {
                let _ = channel.close();
                return Err("Repository output exceeded the size limit".into());
            }
            channel.wait_eof().map_err(|error| error.to_string())?;
            channel.close().map_err(|error| error.to_string())?;
            channel.wait_close().map_err(|error| error.to_string())?;
            let success = channel.exit_status().map_err(|error| error.to_string())? == 0;
            return Ok(Output {
                success,
                error: if success { Vec::new() } else { bytes.clone() },
                bytes,
            });
        }
        tauri::async_runtime::block_on(self.run_local(args, limit))
    }

    async fn run_local(&self, args: &[&str], limit: usize) -> Result<Output, String> {
        use tokio::io::AsyncReadExt;
        let mut command = tokio::process::Command::new("git");
        command
            .args(["--no-pager", "--literal-pathspecs"])
            .args(args)
            .current_dir(&self.cwd)
            .env("LC_ALL", "C")
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_EDITOR", "true")
            .env("GIT_MERGE_AUTOEDIT", "no")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        {
            command.creation_flags(0x08000000);
        }
        let mut child = command
            .spawn()
            .map_err(|error| format!("Could not start the version control executable: {error}"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or("Could not read repository output")?;
        let stderr = child
            .stderr
            .take()
            .ok_or("Could not read repository error")?;
        let operation = async {
            let mut bytes = Vec::new();
            let mut error = Vec::new();
            let mut stdout = stdout.take(limit as u64 + 1);
            let mut stderr = stderr.take(8193);
            let (outcome, errors) = tokio::join!(
                stdout.read_to_end(&mut bytes),
                stderr.read_to_end(&mut error)
            );
            outcome.map_err(|error| error.to_string())?;
            errors.map_err(|error| error.to_string())?;
            if bytes.len() > limit || error.len() > 8192 {
                return Err("Repository output exceeded the size limit".to_owned());
            }
            let success = child
                .wait()
                .await
                .map_err(|error| error.to_string())?
                .success();
            Ok(Output {
                success,
                bytes,
                error,
            })
        };
        match tokio::time::timeout(operation_timeout(args), operation).await {
            Ok(Ok(output)) => Ok(output),
            outcome => {
                let _ = child.kill().await;
                match outcome {
                    Ok(Err(error)) => Err(error),
                    _ => Err("The repository operation timed out".into()),
                }
            }
        }
    }

    fn checked(&self, args: &[&str], limit: usize) -> Result<Vec<u8>, String> {
        let output = self.run(args, limit)?;
        if output.success {
            Ok(output.bytes)
        } else {
            Err(
                "The version control operation failed. Refresh the repository and try again."
                    .into(),
            )
        }
    }

    fn snapshot(&mut self) -> Result<Option<GitSnapshot>, String> {
        let output = self.run(&["rev-parse", "--show-toplevel"], MAX_STATUS)?;
        if !output.success {
            return if String::from_utf8_lossy(&output.error).contains("not a git repository") {
                Ok(None)
            } else {
                Err("Could not open the repository. Check access and the version control installation.".into())
            };
        }
        let root = String::from_utf8(output.bytes)
            .map_err(|_| "The repository path is not valid UTF-8")?;
        let root = root.strip_suffix('\n').unwrap_or(&root);
        let root = root.strip_suffix('\r').unwrap_or(root).to_owned();
        self.cwd = root.clone();
        let status = self.checked(
            &[
                "status",
                "--porcelain=v1",
                "-z",
                "--untracked-files=all",
                "--ignore-submodules=dirty",
            ],
            MAX_STATUS,
        )?;
        let branch = self.run(&["symbolic-ref", "--short", "HEAD"], 4096)?;
        let detached = !branch.success;
        let branch = if branch.success {
            branch.bytes
        } else {
            self.checked(&["rev-parse", "--short", "HEAD"], 4096)?
        };
        let upstream = self.run(
            &[
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                "@{upstream}",
            ],
            4096,
        )?;
        let upstream = upstream
            .success
            .then(|| String::from_utf8_lossy(&upstream.bytes).trim().to_owned());
        let (mut ahead, mut behind) = (0, 0);
        if upstream.is_some() {
            let counts = self.checked(
                &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
                4096,
            )?;
            let counts = String::from_utf8_lossy(&counts);
            let mut values = counts.split_whitespace();
            ahead = values
                .next()
                .and_then(|value| value.parse().ok())
                .unwrap_or(0);
            behind = values
                .next()
                .and_then(|value| value.parse().ok())
                .unwrap_or(0);
        }
        let remotes = self.checked(&["remote"], 65536)?;
        Ok(Some(GitSnapshot {
            root,
            branch: String::from_utf8_lossy(&branch).trim().to_owned(),
            entries: parse_status(&status)?,
            has_head: self.run(&["rev-parse", "--verify", "HEAD"], 4096)?.success,
            operation: self.progress()?,
            upstream,
            ahead,
            behind,
            detached,
            remotes: String::from_utf8_lossy(&remotes)
                .lines()
                .map(str::to_owned)
                .collect(),
        }))
    }

    fn blob(&self, revision: &str, absent: bool) -> Result<Vec<u8>, String> {
        let size = self.run(&["cat-file", "-s", revision], 4096)?;
        if !size.success {
            return if absent {
                Ok(Vec::new())
            } else {
                Err("The compared revision is no longer available. Refresh the repository.".into())
            };
        }
        let size: usize = String::from_utf8_lossy(&size.bytes)
            .trim()
            .parse()
            .map_err(|_| "Invalid object size")?;
        if size > MAX_CONTENT {
            return Ok(vec![0; MAX_CONTENT + 1]);
        }
        self.checked(&["show", revision], MAX_CONTENT)
    }

    fn working_file(&self, path: &str) -> Result<Vec<u8>, String> {
        let mut bytes = Vec::new();
        if let Some(session) = &self.session {
            let sftp = session.sftp().map_err(|error| error.to_string())?;
            let file_path = format!("{}/{path}", self.cwd.trim_end_matches('/'));
            let path = Path::new(&file_path);
            let stat = sftp.lstat(path).map_err(|error| error.to_string())?;
            if stat.file_type().is_symlink() {
                return Ok(sftp
                    .readlink(path)
                    .map_err(|error| error.to_string())?
                    .to_string_lossy()
                    .as_bytes()
                    .to_vec());
            }
            if !stat.is_file() {
                return Err("This repository entry is not a text file".into());
            }
            sftp.open(path)
                .map_err(|error| error.to_string())?
                .take(MAX_CONTENT as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|error| error.to_string())?;
        } else {
            let path = Path::new(&self.cwd).join(path);
            let stat = std::fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
            if stat.is_symlink() {
                return Ok(std::fs::read_link(&path)
                    .map_err(|error| error.to_string())?
                    .to_string_lossy()
                    .as_bytes()
                    .to_vec());
            }
            if !stat.is_file() {
                return Err("This repository entry is not a text file".into());
            }
            std::fs::File::open(path)
                .map_err(|error| error.to_string())?
                .take(MAX_CONTENT as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|error| error.to_string())?;
        }
        Ok(bytes)
    }

    fn diff(&mut self, path: &str, scope: GitScope) -> Result<GitDiff, String> {
        validate_path(path)?;
        let snapshot = self
            .snapshot()?
            .ok_or("The directory is not in a repository")?;
        let entry = snapshot
            .entries
            .iter()
            .find(|entry| entry.path == path)
            .ok_or("The file has no changes. Refresh the repository.")?;
        let (original, modified) = match scope {
            GitScope::Staged => {
                if entry.index_status == " " || entry.index_status == "?" || is_conflict(entry) {
                    return Err("The staged comparison is no longer available".into());
                }
                let old_path = entry.previous_path.as_deref().unwrap_or(path);
                (
                    if entry.index_status == "A" {
                        Vec::new()
                    } else {
                        self.blob(&format!("HEAD:{old_path}"), false)?
                    },
                    if entry.index_status == "D" {
                        Vec::new()
                    } else {
                        self.blob(&format!(":{path}"), false)?
                    },
                )
            }
            GitScope::Conflicts => {
                if !is_conflict(entry) {
                    return Err("The file no longer has an unresolved conflict".into());
                }
                (
                    self.blob(&format!(":2:{path}"), true)?,
                    self.blob(&format!(":3:{path}"), true)?,
                )
            }
            GitScope::Untracked => {
                if entry.index_status != "?" {
                    return Err("The untracked comparison is no longer available".into());
                }
                (Vec::new(), self.working_file(path)?)
            }
            GitScope::Unstaged => {
                if entry.worktree_status == " "
                    || entry.worktree_status == "?"
                    || is_conflict(entry)
                {
                    return Err("The working comparison is no longer available".into());
                }
                (
                    self.blob(&format!(":{path}"), false)?,
                    if entry.worktree_status == "D" {
                        Vec::new()
                    } else {
                        self.working_file(path)?
                    },
                )
            }
        };
        Ok(text_diff(original, modified))
    }

    fn change(&mut self, path: &str, action: GitAction) -> Result<(), String> {
        validate_path(path)?;
        let snapshot = self
            .snapshot()?
            .ok_or("The directory is not in a repository")?;
        let entry = snapshot
            .entries
            .iter()
            .find(|entry| entry.path == path)
            .ok_or("The file has no changes")?;
        if is_conflict(entry) {
            if matches!(action, GitAction::Resolve) {
                return self
                    .checked(&["add", "-A", "--", path], MAX_STATUS)
                    .map(|_| ());
            }
            return Err("Resolve the conflict in an editor or terminal before staging it".into());
        }
        if matches!(action, GitAction::Resolve) {
            return Err("The file no longer has an unresolved conflict".into());
        }
        if matches!(action, GitAction::Discard) {
            if entry.index_status == "?" {
                if self.session.is_some() {
                    return self
                        .checked(&["clean", "-f", "--", path], MAX_STATUS)
                        .map(|_| ());
                }
                let file = Path::new(&self.cwd).join(path);
                let parent = file
                    .parent()
                    .ok_or("Invalid file directory")?
                    .canonicalize()
                    .map_err(|error| error.to_string())?;
                let root = Path::new(&self.cwd)
                    .canonicalize()
                    .map_err(|error| error.to_string())?;
                if !parent.starts_with(root)
                    || std::fs::symlink_metadata(&file)
                        .map_err(|error| error.to_string())?
                        .is_dir()
                {
                    return Err("The file changed or is outside the repository".into());
                }
                return trash::delete(&file).map_err(|error| error.to_string());
            }
            if entry.worktree_status == " " {
                return Err("The file has no unstaged changes".into());
            }
            return self
                .checked(&["restore", "--worktree", "--", path], MAX_STATUS)
                .map(|_| ());
        }
        let mut paths = vec![path];
        if matches!(action, GitAction::Unstage) && entry.index_status == "R" {
            if let Some(previous) = entry.previous_path.as_deref() {
                validate_path(previous)?;
                paths.push(previous);
            }
        }
        let mut args = match action {
            GitAction::Stage => vec!["add", "--"],
            GitAction::Unstage => {
                if self.run(&["rev-parse", "--verify", "HEAD"], 4096)?.success {
                    vec!["restore", "--staged", "--"]
                } else {
                    vec!["rm", "--cached", "-f", "--ignore-unmatch", "--"]
                }
            }
            GitAction::Discard | GitAction::Resolve => return Err("Invalid file action".into()),
        };
        args.extend(paths);
        self.checked(&args, MAX_STATUS).map(|_| ())
    }

    fn operate(
        &mut self,
        operation: GitOperation,
        message: Option<&str>,
        remote: Option<&str>,
    ) -> Result<(), String> {
        let snapshot = self
            .snapshot()?
            .ok_or("The directory is not in a repository")?;
        let conflicts = snapshot.entries.iter().any(is_conflict);
        let staged = snapshot
            .entries
            .iter()
            .any(|entry| entry.index_status != " " && entry.index_status != "?");
        let remote = remote.or_else(|| snapshot.remotes.first().map(String::as_str));
        if let Some(remote) = remote {
            if !snapshot.remotes.iter().any(|name| name == remote) || remote.starts_with('-') {
                return Err("Select a configured remote".into());
            }
        }
        let message = message.unwrap_or("").trim();
        let destination = format!("HEAD:refs/heads/{}", snapshot.branch);
        let tracking_remote = self.run(
            &[
                "config",
                "--get",
                &format!("branch.{}.remote", snapshot.branch),
            ],
            4096,
        )?;
        let tracking_remote = String::from_utf8_lossy(&tracking_remote.bytes);
        let use_tracking = snapshot.upstream.is_some()
            && remote.is_some_and(|remote| tracking_remote.trim() == remote);
        let args = match operation {
            GitOperation::Sync => {
                if snapshot.detached || !use_tracking {
                    return Err("Publish a branch with an upstream before synchronizing".into());
                }
                if !snapshot.entries.is_empty() {
                    return Err("Commit or set aside changes before synchronizing".into());
                }
                self.operate(GitOperation::Pull, None, remote)?;
                return self.operate(GitOperation::Push, None, remote);
            }
            GitOperation::StageAll => {
                if conflicts {
                    return Err("Resolve merge conflicts before staging all files".into());
                }
                vec!["add", "-A", "--", "."]
            }
            GitOperation::UnstageAll => {
                if conflicts {
                    return Err("Resolve merge conflicts before unstaging all files".into());
                }
                if self.run(&["rev-parse", "--verify", "HEAD"], 4096)?.success {
                    vec!["restore", "--staged", "--", "."]
                } else {
                    vec!["rm", "--cached", "-r", "-f", "--ignore-unmatch", "--", "."]
                }
            }
            GitOperation::Commit => {
                if conflicts {
                    return Err("Resolve merge conflicts before committing".into());
                }
                if !staged {
                    return Err("Stage changes before committing".into());
                }
                if message.is_empty() || message.len() > 65536 || message.contains('\0') {
                    return Err("Enter a valid commit message".into());
                }
                vec!["commit", "-m", message]
            }
            GitOperation::Fetch => vec!["fetch", remote.ok_or("Add a remote before fetching")?],
            GitOperation::Pull => {
                if snapshot.detached {
                    return Err("Check out a branch before pulling".into());
                }
                if conflicts {
                    return Err("Resolve merge conflicts before pulling".into());
                }
                if use_tracking {
                    vec!["pull", "--ff-only"]
                } else {
                    vec![
                        "pull",
                        "--ff-only",
                        remote.ok_or("Add a remote before pulling")?,
                        &snapshot.branch,
                    ]
                }
            }
            GitOperation::Push => {
                if snapshot.detached {
                    return Err("Check out a branch before pushing".into());
                }
                if use_tracking {
                    vec!["push", remote.ok_or("Add a remote before pushing")?]
                } else if snapshot.upstream.is_some() {
                    vec![
                        "push",
                        remote.ok_or("Add a remote before pushing")?,
                        &destination,
                    ]
                } else {
                    vec![
                        "push",
                        "--set-upstream",
                        remote.ok_or("Add a remote before pushing")?,
                        &destination,
                    ]
                }
            }
        };
        let output = self.run(&args, MAX_STATUS)?;
        if output.success {
            Ok(())
        } else {
            let detail = if output.error.is_empty() {
                &output.bytes
            } else {
                &output.error
            };
            let detail = crate::redact::redact_text(&String::from_utf8_lossy(detail));
            Err(if detail.trim().is_empty() {
                "The repository operation failed".into()
            } else {
                detail.trim().to_owned()
            })
        }
    }

    fn branches(&mut self) -> Result<Vec<String>, String> {
        self.snapshot()?
            .ok_or("The directory is not in a repository")?;
        let bytes = self.checked(
            &["for-each-ref", "--format=%(refname:short)", "refs/heads/"],
            MAX_STATUS,
        )?;
        Ok(String::from_utf8_lossy(&bytes)
            .lines()
            .map(str::to_owned)
            .collect())
    }

    fn worktrees(&self) -> Result<Vec<GitWorktree>, String> {
        parse_worktrees(&self.checked(&["worktree", "list", "--porcelain", "-z"], MAX_STATUS)?)
    }

    fn switch_branch(&mut self, branch: &str) -> Result<(), String> {
        let snapshot = self
            .snapshot()?
            .ok_or("The directory is not in a repository")?;
        if !snapshot.entries.is_empty() {
            return Err("Commit or set aside changes before switching branches".into());
        }
        if branch.starts_with('-') || !self.branches()?.iter().any(|name| name == branch) {
            return Err("Select an existing local branch".into());
        }
        let output = self.run(&["switch", "--", branch], MAX_STATUS)?;
        if output.success {
            Ok(())
        } else {
            Err(crate::redact::redact_text(&String::from_utf8_lossy(
                &output.error,
            )))
        }
    }

    fn commit_context(&mut self) -> Result<String, String> {
        let snapshot = self
            .snapshot()?
            .ok_or("The directory is not in a repository")?;
        if snapshot.entries.iter().any(is_conflict) {
            return Err("Resolve merge conflicts before generating a commit message".into());
        }
        let paths: Vec<_> = snapshot
            .entries
            .iter()
            .filter(|entry| entry.index_status != " " && entry.index_status != "?")
            .map(|entry| format!("{} {}", entry.index_status, entry.path))
            .collect();
        if paths.is_empty() {
            return Err("Stage changes before generating a commit message".into());
        }
        let diff = self.checked(
            &[
                "diff",
                "--cached",
                "--no-ext-diff",
                "--no-textconv",
                "--unified=3",
            ],
            MAX_STATUS,
        )?;
        let diff = crate::redact::redact_text(&String::from_utf8_lossy(&diff));
        Ok(format!(
            "Staged files:\n{}\n\nStaged patch:\n{}",
            paths.join("\n"),
            diff.chars().take(32000).collect::<String>()
        ))
    }
}

fn operation_timeout(args: &[&str]) -> Duration {
    Duration::from_secs(match args.first().copied() {
        Some("fetch" | "pull" | "push") => 120,
        Some("commit" | "merge" | "rebase") => 60,
        _ => 15,
    })
}

fn validate_path(path: &str) -> Result<(), String> {
    if path.is_empty()
        || path.contains('\0')
        || (cfg!(windows) && path.contains('\\'))
        || path.starts_with('/')
        || Path::new(path).is_absolute()
        || path
            .split('/')
            .any(|part| part == ".." || part == "." || part.is_empty())
    {
        return Err("Invalid repository-relative path".into());
    }
    Ok(())
}

fn is_conflict(entry: &GitEntry) -> bool {
    matches!(
        format!("{}{}", entry.index_status, entry.worktree_status).as_str(),
        "DD" | "AU" | "UD" | "UA" | "DU" | "AA" | "UU"
    )
}

fn parse_status(bytes: &[u8]) -> Result<Vec<GitEntry>, String> {
    let mut records = bytes
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty());
    let mut entries = Vec::new();
    while let Some(record) = records.next() {
        if record.len() < 4 || record[2] != b' ' {
            return Err("Invalid repository status response".into());
        }
        let path = String::from_utf8(record[3..].to_vec())
            .map_err(|_| "A changed path is not valid UTF-8")?;
        validate_path(&path)?;
        let renamed = record[..2]
            .iter()
            .any(|status| *status == b'R' || *status == b'C');
        let previous_path = if renamed {
            Some(
                String::from_utf8(records.next().ok_or("Missing original path")?.to_vec())
                    .map_err(|_| "The original path is not valid UTF-8")?,
            )
        } else {
            None
        };
        entries.push(GitEntry {
            path,
            previous_path,
            index_status: (record[0] as char).to_string(),
            worktree_status: (record[1] as char).to_string(),
        });
    }
    Ok(entries)
}

fn text_diff(original: Vec<u8>, modified: Vec<u8>) -> GitDiff {
    if original.len() > MAX_CONTENT || modified.len() > MAX_CONTENT {
        return GitDiff {
            original: String::new(),
            modified: String::new(),
            kind: "tooLarge",
        };
    }
    if original.contains(&0) || modified.contains(&0) {
        return GitDiff {
            original: String::new(),
            modified: String::new(),
            kind: "binary",
        };
    }
    match (String::from_utf8(original), String::from_utf8(modified)) {
        (Ok(original), Ok(modified)) => GitDiff {
            original,
            modified,
            kind: "text",
        },
        _ => GitDiff {
            original: String::new(),
            modified: String::new(),
            kind: "binary",
        },
    }
}

fn get_connection(
    state: &HistoryState,
    target: &GitTarget,
) -> Result<Option<SshConnection>, String> {
    target
        .connection_id
        .as_ref()
        .map(|id| {
            state
                .0
                .lock()
                .map_err(|error| error.to_string())?
                .get_ssh_connection(id)
        })
        .transpose()
}

#[tauri::command]
pub async fn git_snapshot(
    state: tauri::State<'_, HistoryState>,
    target: GitTarget,
) -> Result<Option<GitSnapshot>, String> {
    let connection = get_connection(&state, &target)?;
    tauri::async_runtime::spawn_blocking(move || Runner::new(target, connection)?.snapshot())
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn git_diff(
    state: tauri::State<'_, HistoryState>,
    target: GitTarget,
    path: String,
    scope: GitScope,
) -> Result<GitDiff, String> {
    let connection = get_connection(&state, &target)?;
    tauri::async_runtime::spawn_blocking(move || {
        Runner::new(target, connection)?.diff(&path, scope)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn git_change_file(
    state: tauri::State<'_, HistoryState>,
    target: GitTarget,
    path: String,
    action: GitAction,
) -> Result<(), String> {
    let connection = get_connection(&state, &target)?;
    tauri::async_runtime::spawn_blocking(move || {
        Runner::new(target, connection)?.change(&path, action)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn git_operate(
    state: tauri::State<'_, HistoryState>,
    target: GitTarget,
    operation: GitOperation,
    message: Option<String>,
    remote: Option<String>,
) -> Result<(), String> {
    let connection = get_connection(&state, &target)?;
    tauri::async_runtime::spawn_blocking(move || {
        Runner::new(target, connection)?.operate(operation, message.as_deref(), remote.as_deref())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn git_commit_context(
    state: tauri::State<'_, HistoryState>,
    target: GitTarget,
) -> Result<String, String> {
    let connection = get_connection(&state, &target)?;
    tauri::async_runtime::spawn_blocking(move || Runner::new(target, connection)?.commit_context())
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn git_branches(
    state: tauri::State<'_, HistoryState>,
    target: GitTarget,
) -> Result<Vec<String>, String> {
    let connection = get_connection(&state, &target)?;
    tauri::async_runtime::spawn_blocking(move || Runner::new(target, connection)?.branches())
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn git_switch_branch(
    state: tauri::State<'_, HistoryState>,
    target: GitTarget,
    branch: String,
) -> Result<(), String> {
    let connection = get_connection(&state, &target)?;
    tauri::async_runtime::spawn_blocking(move || {
        Runner::new(target, connection)?.switch_branch(&branch)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn git_worktrees(
    state: tauri::State<'_, HistoryState>,
    target: GitTarget,
) -> Result<Vec<GitWorktree>, String> {
    let connection = get_connection(&state, &target)?;
    tauri::async_runtime::spawn_blocking(move || Runner::new(target, connection)?.worktrees())
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn git_references(
    state: tauri::State<'_, HistoryState>,
    target: GitTarget,
) -> Result<Vec<GitReference>, String> {
    let connection = get_connection(&state, &target)?;
    tauri::async_runtime::spawn_blocking(move || Runner::new(target, connection)?.references())
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn git_edit_reference(
    state: tauri::State<'_, HistoryState>,
    target: GitTarget,
    action: GitReferenceAction,
    name: String,
    new_name: Option<String>,
    start_point: Option<String>,
    message: Option<String>,
) -> Result<(), String> {
    let connection = get_connection(&state, &target)?;
    tauri::async_runtime::spawn_blocking(move || {
        Runner::new(target, connection)?.edit_reference(
            action,
            &name,
            new_name.as_deref(),
            start_point.as_deref(),
            message.as_deref(),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    pub(super) struct Repository {
        path: std::path::PathBuf,
    }
    impl Repository {
        pub(super) fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("git-panel-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&path).unwrap();
            let repo = Self { path };
            repo.git(&["init", "-b", "main"]);
            repo.git(&["config", "user.email", "test@example.invalid"]);
            repo.git(&["config", "user.name", "Test"]);
            repo.git(&["config", "core.autocrlf", "false"]);
            repo
        }
        pub(super) fn git(&self, args: &[&str]) {
            assert!(Command::new("git")
                .current_dir(&self.path)
                .args(args)
                .output()
                .unwrap()
                .status
                .success());
        }
        pub(super) fn write(&self, path: &str, text: &str) {
            std::fs::write(self.path.join(path), text).unwrap();
        }
        pub(super) fn runner(&self) -> Runner {
            Runner::new(
                GitTarget {
                    cwd: self.path.to_string_lossy().into(),
                    connection_id: None,
                },
                None,
            )
            .unwrap()
        }
    }
    impl Drop for Repository {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn worktree_records_preserve_paths_and_optional_annotations() {
        let trees = parse_worktrees(b"worktree /repo with spaces\0HEAD abc\0branch refs/heads/main\0\0worktree /repo\nlinked\0HEAD def\0detached\0locked reason\nmore\0prunable missing directory\0\0worktree /bare\0bare\0\0").unwrap();
        assert_eq!(trees.len(), 3);
        assert_eq!(trees[0].branch.as_deref(), Some("main"));
        assert_eq!(trees[1].path, "/repo\nlinked");
        assert!(trees[1].detached);
        assert_eq!(trees[1].locked.as_deref(), Some("reason\nmore"));
        assert_eq!(trees[1].prunable.as_deref(), Some("missing directory"));
        assert!(trees[2].bare);
        assert!(parse_worktrees(&[255]).is_err());
    }

    #[test]
    fn lists_linked_worktrees_and_lock_state_without_changing_them() {
        let repo = Repository::new();
        repo.write("file.ts", "base\n");
        repo.git(&["add", "."]);
        repo.git(&["commit", "-m", "base"]);
        let linked = repo.path.join("linked worktree");
        let path = linked.to_str().unwrap();
        repo.git(&["worktree", "add", "-b", "feature", path]);
        repo.git(&["worktree", "lock", "--reason", "in use", path]);
        let trees = repo.runner().worktrees().unwrap();
        assert_eq!(trees.len(), 2);
        let tree = trees
            .iter()
            .find(|tree| tree.branch.as_deref() == Some("feature"))
            .unwrap();
        assert_eq!(tree.locked.as_deref(), Some("in use"));
        assert_eq!(
            std::fs::read_to_string(linked.join("file.ts")).unwrap(),
            "base\n"
        );
        repo.git(&["worktree", "unlock", path]);
        repo.git(&["worktree", "remove", path]);
    }

    #[test]
    fn nul_status_preserves_renames_unicode_and_newlines() {
        let entries = parse_status(
            "R  new name.ts\0old name.ts\0?? 路径\nfile.ts\0MM partial.ts\0".as_bytes(),
        )
        .unwrap();
        assert_eq!(entries[0].previous_path.as_deref(), Some("old name.ts"));
        assert_eq!(entries[1].path, "路径\nfile.ts");
        assert_eq!(entries[2].worktree_status, "M");
        assert!(parse_status(b"R  missing\0").is_err());
        assert!(validate_path("../outside").is_err());
    }

    #[test]
    fn partially_staged_comparisons_and_unstage_preserve_working_content() {
        let repo = Repository::new();
        repo.write("file.ts", "base\n");
        repo.git(&["add", "."]);
        repo.git(&["commit", "-m", "base"]);
        repo.write("file.ts", "staged\n");
        repo.git(&["add", "."]);
        repo.write("file.ts", "working\n");
        let mut runner = repo.runner();
        let staged = runner.diff("file.ts", GitScope::Staged).unwrap();
        assert_eq!(
            (staged.original.as_str(), staged.modified.as_str()),
            ("base\n", "staged\n")
        );
        let unstaged = runner.diff("file.ts", GitScope::Unstaged).unwrap();
        assert_eq!(
            (unstaged.original.as_str(), unstaged.modified.as_str()),
            ("staged\n", "working\n")
        );
        runner.change("file.ts", GitAction::Unstage).unwrap();
        assert_eq!(
            std::fs::read_to_string(repo.path.join("file.ts")).unwrap(),
            "working\n"
        );
        assert_eq!(
            runner.diff("file.ts", GitScope::Unstaged).unwrap().original,
            "base\n"
        );
    }

    #[test]
    fn unborn_branch_supports_additions_and_literal_names() {
        let repo = Repository::new();
        repo.write("[new] file.ts", "new\n");
        let mut runner = repo.runner();
        assert_eq!(runner.snapshot().unwrap().unwrap().branch, "main");
        assert_eq!(
            runner
                .diff("[new] file.ts", GitScope::Untracked)
                .unwrap()
                .modified,
            "new\n"
        );
        runner.change("[new] file.ts", GitAction::Stage).unwrap();
        assert_eq!(
            runner
                .diff("[new] file.ts", GitScope::Staged)
                .unwrap()
                .original,
            ""
        );
        repo.write("[new] file.ts", "working changes\n");
        runner.change("[new] file.ts", GitAction::Unstage).unwrap();
        assert_eq!(
            runner.snapshot().unwrap().unwrap().entries[0].index_status,
            "?"
        );
        assert!(repo.path.join("[new] file.ts").exists());
    }

    #[test]
    fn staged_renames_and_deletions_use_the_correct_original() {
        let repo = Repository::new();
        repo.write("old.ts", "content\n");
        repo.git(&["add", "."]);
        repo.git(&["commit", "-m", "base"]);
        repo.git(&["mv", "old.ts", "new.ts"]);
        let mut runner = repo.runner();
        let diff = runner.diff("new.ts", GitScope::Staged).unwrap();
        assert_eq!(diff.original, "content\n");
        assert_eq!(diff.original, diff.modified);
        repo.write("new.ts", "content\nextra\n");
        runner.change("new.ts", GitAction::Stage).unwrap();
        assert_eq!(
            runner.diff("new.ts", GitScope::Staged).unwrap().modified,
            "content\nextra\n"
        );
        runner.change("new.ts", GitAction::Unstage).unwrap();
        assert!(repo.path.join("new.ts").exists());
        assert_eq!(
            runner.diff("old.ts", GitScope::Unstaged).unwrap().modified,
            ""
        );
    }

    #[test]
    fn conflict_sides_are_read_without_modifying_the_index() {
        let repo = Repository::new();
        repo.write("file.ts", "base\n");
        repo.git(&["add", "."]);
        repo.git(&["commit", "-m", "base"]);
        repo.git(&["checkout", "-b", "incoming"]);
        repo.write("file.ts", "incoming\n");
        repo.git(&["commit", "-am", "incoming"]);
        repo.git(&["checkout", "main"]);
        repo.write("file.ts", "current\n");
        repo.git(&["commit", "-am", "current"]);
        assert!(!Command::new("git")
            .current_dir(&repo.path)
            .args(["merge", "incoming"])
            .output()
            .unwrap()
            .status
            .success());
        let mut runner = repo.runner();
        let diff = runner.diff("file.ts", GitScope::Conflicts).unwrap();
        assert_eq!(
            (diff.original.as_str(), diff.modified.as_str()),
            ("current\n", "incoming\n")
        );
        assert!(runner.change("file.ts", GitAction::Stage).is_err());
    }

    #[test]
    fn binary_and_oversized_content_have_explicit_fallbacks() {
        assert_eq!(text_diff(vec![], vec![0, 1]).kind, "binary");
        assert_eq!(text_diff(vec![0xff], vec![]).kind, "binary");
        assert_eq!(
            text_diff(vec![], vec![b'x'; MAX_CONTENT + 1]).kind,
            "tooLarge"
        );
    }

    #[test]
    fn commits_only_the_index_and_keeps_unstaged_edits() {
        let repo = Repository::new();
        repo.write("file.ts", "staged\n");
        let mut runner = repo.runner();
        assert!(runner
            .operate(GitOperation::Commit, Some("feat: initial"), None)
            .is_err());
        runner.operate(GitOperation::StageAll, None, None).unwrap();
        repo.write("file.ts", "unstaged\n");
        let context = runner.commit_context().unwrap();
        assert!(context.contains("+staged"));
        assert!(!context.contains("+unstaged"));
        assert!(runner
            .operate(GitOperation::Commit, Some("  "), None)
            .is_err());
        runner
            .operate(
                GitOperation::Commit,
                Some("feat: initial\n\nKeep working edits"),
                None,
            )
            .unwrap();
        let snapshot = runner.snapshot().unwrap().unwrap();
        assert_eq!(snapshot.entries.len(), 1);
        assert_eq!(snapshot.entries[0].index_status, " ");
        assert_eq!(snapshot.entries[0].worktree_status, "M");
        assert_eq!(
            runner.diff("file.ts", GitScope::Unstaged).unwrap().original,
            "staged\n"
        );
        runner.operate(GitOperation::StageAll, None, None).unwrap();
        runner
            .operate(GitOperation::UnstageAll, None, None)
            .unwrap();
        assert_eq!(
            std::fs::read_to_string(repo.path.join("file.ts")).unwrap(),
            "unstaged\n"
        );
    }

    #[test]
    fn discard_restores_the_index_and_preserves_staged_changes() {
        let repo = Repository::new();
        repo.write("file.ts", "base\n");
        repo.git(&["add", "."]);
        repo.git(&["commit", "-m", "base"]);
        repo.write("file.ts", "staged\n");
        repo.git(&["add", "."]);
        repo.write("file.ts", "working\n");
        let mut runner = repo.runner();
        runner.change("file.ts", GitAction::Discard).unwrap();
        assert_eq!(
            std::fs::read_to_string(repo.path.join("file.ts")).unwrap(),
            "staged\n"
        );
        assert_eq!(
            runner.diff("file.ts", GitScope::Staged).unwrap().modified,
            "staged\n"
        );
        assert_eq!(
            runner.snapshot().unwrap().unwrap().entries[0].worktree_status,
            " "
        );
        assert!(runner.change("../file.ts", GitAction::Discard).is_err());
    }

    #[test]
    fn branch_switch_requires_a_clean_worktree_and_an_existing_local_branch() {
        let repo = Repository::new();
        repo.write("file.ts", "base\n");
        repo.git(&["add", "."]);
        repo.git(&["commit", "-m", "base"]);
        repo.git(&["branch", "feature/review"]);
        let mut runner = repo.runner();
        assert!(runner
            .branches()
            .unwrap()
            .contains(&"feature/review".to_owned()));
        assert!(runner.switch_branch("--detach").is_err());
        runner.switch_branch("feature/review").unwrap();
        assert_eq!(runner.snapshot().unwrap().unwrap().branch, "feature/review");
        repo.write("file.ts", "unsaved\n");
        assert!(runner.switch_branch("main").is_err());
        assert_eq!(
            std::fs::read_to_string(repo.path.join("file.ts")).unwrap(),
            "unsaved\n"
        );
    }

    #[test]
    fn remote_operations_track_publish_fetch_pull_and_reject_divergence() {
        let remote = Repository {
            path: std::env::temp_dir().join(format!("git-remote-test-{}", uuid::Uuid::new_v4())),
        };
        std::fs::create_dir(&remote.path).unwrap();
        remote.git(&["init", "--bare", "-b", "main"]);
        let repo = Repository::new();
        repo.write("file.ts", "base\n");
        repo.git(&["remote", "add", "origin", remote.path.to_str().unwrap()]);
        let mut runner = repo.runner();
        runner.operate(GitOperation::StageAll, None, None).unwrap();
        runner
            .operate(GitOperation::Commit, Some("feat: initial"), None)
            .unwrap();
        assert!(runner
            .operate(GitOperation::Push, None, Some("--all"))
            .is_err());
        runner
            .operate(GitOperation::Push, None, Some("origin"))
            .unwrap();
        assert_eq!(
            runner.snapshot().unwrap().unwrap().upstream.as_deref(),
            Some("origin/main")
        );
        let other = Repository::new();
        other.git(&["remote", "add", "origin", remote.path.to_str().unwrap()]);
        other.git(&["fetch", "origin"]);
        other.git(&["checkout", "-B", "main", "--track", "origin/main"]);
        other.write("remote.ts", "incoming\n");
        other.git(&["add", "."]);
        other.git(&["commit", "-m", "feat: remote"]);
        other.git(&["push"]);
        runner
            .operate(GitOperation::Fetch, None, Some("origin"))
            .unwrap();
        assert_eq!(runner.snapshot().unwrap().unwrap().behind, 1);
        runner
            .operate(GitOperation::Sync, None, Some("origin"))
            .unwrap();
        assert_eq!(
            std::fs::read_to_string(repo.path.join("remote.ts")).unwrap(),
            "incoming\n"
        );
        repo.write("local.ts", "local\n");
        runner.operate(GitOperation::StageAll, None, None).unwrap();
        runner
            .operate(GitOperation::Commit, Some("feat: local"), None)
            .unwrap();
        assert_eq!(runner.snapshot().unwrap().unwrap().ahead, 1);
        other.write("another.ts", "remote\n");
        other.git(&["add", "."]);
        other.git(&["commit", "-m", "feat: another"]);
        other.git(&["push"]);
        let before_sync = runner
            .checked(&["ls-remote", "origin", "refs/heads/main"], 4096)
            .unwrap();
        assert!(runner
            .operate(GitOperation::Sync, None, Some("origin"))
            .is_err());
        assert_eq!(
            before_sync,
            runner
                .checked(&["ls-remote", "origin", "refs/heads/main"], 4096)
                .unwrap()
        );
        assert!(runner
            .operate(GitOperation::Pull, None, Some("origin"))
            .is_err());
        assert!(repo.path.join("local.ts").exists());
        assert!(!repo.path.join("another.ts").exists());
        assert!(runner
            .operate(GitOperation::Push, None, Some("origin"))
            .is_err());
    }
}
