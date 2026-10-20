use super::{is_conflict, GitSnapshot, Runner, MAX_STATUS};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitReference {
    name: String,
    short_name: String,
    kind: String,
    hash: String,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GitReferenceAction {
    SwitchBranch,
    CreateBranch,
    RenameBranch,
    DeleteBranch,
    Merge,
    Rebase,
    AbortMerge,
    AbortRebase,
    ContinueRebase,
    CreateTag,
    DeleteTag,
}

#[cfg(test)]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitCommit {
    hash: String,
    parents: Vec<String>,
    author: String,
    timestamp: i64,
    subject: String,
    refs: Vec<String>,
}

impl Runner {
    pub(super) fn progress(&self) -> Result<Option<String>, String> {
        let bytes = self.checked(&["rev-parse", "--absolute-git-dir"], 4096)?;
        let directory = String::from_utf8_lossy(&bytes);
        let directory = directory.strip_suffix('\n').unwrap_or(&directory);
        let directory = directory.strip_suffix('\r').unwrap_or(directory);
        let sftp = self
            .session
            .as_ref()
            .map(|session| session.sftp())
            .transpose()
            .map_err(|error| error.to_string())?;
        for (path, operation) in [
            ("rebase-merge", "rebase"),
            ("rebase-apply", "rebase"),
            ("MERGE_HEAD", "merge"),
        ] {
            let absolute = format!("{directory}/{path}");
            let exists = if let Some(sftp) = &sftp {
                sftp.stat(Path::new(&absolute)).is_ok()
            } else {
                Path::new(&absolute).exists()
            };
            if exists {
                return Ok(Some(operation.into()));
            }
        }
        Ok(None)
    }

    pub(super) fn references(&mut self) -> Result<Vec<GitReference>, String> {
        self.snapshot()?
            .ok_or("The directory is not in a repository")?;
        let bytes = self.checked(
            &[
                "for-each-ref",
                "--format=%(refname)%00%(refname:short)%00%(objectname)%00%(symref)",
                "refs/heads/",
                "refs/remotes/",
                "refs/tags/",
            ],
            MAX_STATUS,
        )?;
        let text = String::from_utf8(bytes).map_err(|_| "Reference metadata is not valid UTF-8")?;
        Ok(text
            .lines()
            .filter_map(|line| {
                let fields: Vec<_> = line.split('\0').collect();
                if fields.len() != 4 || !fields[3].is_empty() {
                    return None;
                }
                let kind = if fields[0].starts_with("refs/heads/") {
                    "branch"
                } else if fields[0].starts_with("refs/remotes/") {
                    "remote"
                } else {
                    "tag"
                };
                Some(GitReference {
                    name: fields[0].into(),
                    short_name: fields[1].into(),
                    hash: fields[2].into(),
                    kind: kind.into(),
                })
            })
            .collect())
    }

    pub(super) fn edit_reference(
        &mut self,
        action: GitReferenceAction,
        name: &str,
        new_name: Option<&str>,
        start_point: Option<&str>,
        message: Option<&str>,
    ) -> Result<(), String> {
        let snapshot = self
            .snapshot()?
            .ok_or("The directory is not in a repository")?;
        let references = self.references()?;
        let branch = || {
            references
                .iter()
                .find(|reference| reference.kind == "branch" && reference.name == name)
                .map(|reference| reference.short_name.as_str())
                .ok_or("Select an existing local branch")
        };
        let source = || {
            if references
                .iter()
                .any(|reference| reference.kind != "tag" && reference.name == name)
            {
                Ok(name)
            } else {
                Err("Select an existing local or remote branch")
            }
        };
        let clean = || clean_checkout(&snapshot);
        let validate = |value: &str, tag: bool| -> Result<(), String> {
            if value.is_empty() || value.starts_with('-') || value.contains('\0') {
                return Err("Enter a valid reference name".into());
            }
            let full = format!("refs/tags/{value}");
            let args = if tag {
                vec!["check-ref-format", full.as_str()]
            } else {
                vec!["check-ref-format", "--branch", value]
            };
            if self.run(&args, 4096)?.success {
                Ok(())
            } else {
                Err("Enter a valid reference name".into())
            }
        };
        let start = start_point.unwrap_or("HEAD");
        let start_commit = format!("{start}^{{commit}}");
        if !matches!(
            action,
            GitReferenceAction::AbortMerge
                | GitReferenceAction::AbortRebase
                | GitReferenceAction::ContinueRebase
        ) && snapshot.operation.is_some()
        {
            return Err("Finish or abort the current repository operation first".into());
        }
        let args: Vec<&str> = match action {
            GitReferenceAction::SwitchBranch => {
                if !snapshot.entries.is_empty() { return Err("Commit or set aside changes before switching branches".into()); }
                vec!["switch", "--", branch()?]
            }
            GitReferenceAction::CreateBranch => {
                validate(name, false)?;
                self.validate_start(start, &references)?;
                vec!["branch", "--", name, start]
            }
            GitReferenceAction::RenameBranch => {
                let next = new_name.unwrap_or("");
                validate(next, false)?;
                vec!["branch", "-m", "--", branch()?, next]
            }
            GitReferenceAction::DeleteBranch => vec!["branch", "-d", "--", branch()?],
            GitReferenceAction::Merge => {
                clean()?;
                vec!["merge", "--no-edit", "--", source()?]
            }
            GitReferenceAction::Rebase => {
                clean()?;
                vec!["rebase", "--", source()?]
            }
            GitReferenceAction::AbortMerge if snapshot.operation.as_deref() == Some("merge") => {
                vec!["merge", "--abort"]
            }
            GitReferenceAction::AbortRebase if snapshot.operation.as_deref() == Some("rebase") => {
                vec!["rebase", "--abort"]
            }
            GitReferenceAction::ContinueRebase
                if snapshot.operation.as_deref() == Some("rebase") =>
            {
                if snapshot.entries.iter().any(is_conflict) {
                    return Err("Resolve and stage conflicts before continuing".into());
                }
                vec!["rebase", "--continue"]
            }
            GitReferenceAction::CreateTag => {
                validate(name, true)?;
                self.validate_start(start, &references)?;
                if let Some(message) = message.filter(|text| !text.trim().is_empty()) {
                    vec!["tag", "-a", "-m", message, "--", name, &start_commit]
                } else {
                    vec!["tag", "--", name, &start_commit]
                }
            }
            GitReferenceAction::DeleteTag => {
                let tag = references
                    .iter()
                    .find(|reference| reference.kind == "tag" && reference.name == name)
                    .ok_or("Select an existing tag")?;
                vec!["tag", "-d", "--", &tag.short_name]
            }
            _ => return Err("No matching repository operation is in progress".into()),
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
            Err(crate::redact::redact_text(&String::from_utf8_lossy(detail))
                .trim()
                .to_owned())
        }
    }

    fn validate_start(&self, value: &str, references: &[GitReference]) -> Result<(), String> {
        if value == "HEAD"
            || references.iter().any(|reference| reference.name == value)
            || (matches!(value.len(), 40 | 64)
                && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        {
            if self
                .run(
                    &["rev-parse", "--verify", &format!("{value}^{{commit}}")],
                    4096,
                )?
                .success
            {
                return Ok(());
            }
        }
        Err("Select an existing commit or reference".into())
    }

    #[cfg(test)]
    fn history(&mut self, limit: usize) -> Result<Vec<GitCommit>, String> {
        let snapshot = self
            .snapshot()?
            .ok_or("The directory is not in a repository")?;
        if !snapshot.has_head && self.references()?.is_empty() {
            return Ok(Vec::new());
        }
        let limit = limit.clamp(50, 2000).to_string();
        let bytes = self.checked(
            &[
                "log",
                "--all",
                "--topo-order",
                "-z",
                "-n",
                &limit,
                "--format=%H%x00%P%x00%an%x00%ct%x00%s%x00%D",
            ],
            MAX_STATUS,
        )?;
        let text = String::from_utf8(bytes).map_err(|_| "Commit metadata is not valid UTF-8")?;
        let fields: Vec<_> = text.split('\0').collect();
        Ok(fields
            .chunks_exact(6)
            .filter(|record| !record[0].is_empty())
            .map(|record| GitCommit {
                hash: record[0].into(),
                parents: record[1].split_whitespace().map(str::to_owned).collect(),
                author: record[2].into(),
                timestamp: record[3].parse().unwrap_or(0),
                subject: record[4].into(),
                refs: record[5]
                    .split(", ")
                    .filter(|value| !value.is_empty())
                    .map(str::to_owned)
                    .collect(),
            })
            .collect())
    }
}

fn clean_checkout(snapshot: &GitSnapshot) -> Result<(), String> {
    if snapshot.detached || !snapshot.has_head {
        return Err("Check out a branch with a commit first".into());
    }
    if !snapshot.entries.is_empty() {
        return Err("Commit or set aside changes before merging or rebasing".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::tests::Repository;
    use super::*;

    fn base() -> Repository {
        let repo = Repository::new();
        repo.write("file.txt", "base\n");
        repo.git(&["add", "."]);
        repo.git(&["commit", "-m", "base"]);
        repo
    }
    fn edit(repo: &Repository, action: GitReferenceAction, name: &str) -> Result<(), String> {
        repo.runner().edit_reference(action, name, None, None, None)
    }
    #[test]
    fn branch_and_tag_management_preserves_history_and_validates_names() {
        let repo = base();
        edit(&repo, GitReferenceAction::CreateBranch, "feature").unwrap();
        repo.runner()
            .edit_reference(
                GitReferenceAction::RenameBranch,
                "refs/heads/feature",
                Some("feature-next"),
                None,
                None,
            )
            .unwrap();
        repo.runner()
            .edit_reference(
                GitReferenceAction::CreateTag,
                "v1.0",
                None,
                None,
                Some("Release notes"),
            )
            .unwrap();
        let history = repo.runner().history(200).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].subject, "base");
        assert!(history[0].parents.is_empty());
        assert!(history[0].refs.iter().any(|value| value == "tag: v1.0"));
        assert!(edit(&repo, GitReferenceAction::CreateBranch, "--bad").is_err());
        assert!(repo
            .runner()
            .edit_reference(
                GitReferenceAction::CreateTag,
                "bad",
                None,
                Some("HEAD; exit"),
                None
            )
            .is_err());
        edit(&repo, GitReferenceAction::DeleteTag, "refs/tags/v1.0").unwrap();
        edit(
            &repo,
            GitReferenceAction::DeleteBranch,
            "refs/heads/feature-next",
        )
        .unwrap();
        assert_eq!(repo.runner().references().unwrap().len(), 1);
    }
    #[test]
    fn clean_merge_and_rebase_preserve_parent_links() {
        let repo = base();
        repo.git(&["switch", "-c", "feature"]);
        repo.write("feature.txt", "feature\n");
        repo.git(&["add", "."]);
        repo.git(&["commit", "-m", "feature"]);
        repo.git(&["switch", "main"]);
        repo.write("main.txt", "main\n");
        repo.git(&["add", "."]);
        repo.git(&["commit", "-m", "main"]);
        edit(&repo, GitReferenceAction::Merge, "refs/heads/feature").unwrap();
        assert_eq!(repo.runner().history(200).unwrap()[0].parents.len(), 2);
        repo.git(&["switch", "-c", "topic", "feature"]);
        repo.write("topic.txt", "topic\n");
        repo.git(&["add", "."]);
        repo.git(&["commit", "-m", "topic"]);
        edit(&repo, GitReferenceAction::Rebase, "refs/heads/main").unwrap();
        let history = repo.runner().history(200).unwrap();
        assert_eq!(history[0].subject, "topic");
        assert_eq!(history[0].parents, vec![history[1].hash.clone()]);
        repo.write("dirty.txt", "dirty");
        assert!(edit(&repo, GitReferenceAction::Rebase, "refs/heads/main").is_err());
    }
    #[test]
    fn conflict_state_is_visible_and_abort_restores_the_start() {
        let repo = base();
        repo.git(&["switch", "-c", "feature"]);
        repo.write("file.txt", "feature\n");
        repo.git(&["commit", "-am", "feature"]);
        repo.git(&["switch", "main"]);
        repo.write("file.txt", "main\n");
        repo.git(&["commit", "-am", "main"]);
        let before = repo
            .runner()
            .history(200)
            .unwrap()
            .into_iter()
            .find(|commit| commit.subject == "main")
            .unwrap()
            .hash;
        assert!(edit(&repo, GitReferenceAction::Merge, "refs/heads/feature").is_err());
        assert_eq!(
            repo.runner()
                .snapshot()
                .unwrap()
                .unwrap()
                .operation
                .as_deref(),
            Some("merge")
        );
        edit(&repo, GitReferenceAction::AbortMerge, "").unwrap();
        assert!(edit(&repo, GitReferenceAction::Rebase, "refs/heads/feature").is_err());
        assert_eq!(
            repo.runner()
                .snapshot()
                .unwrap()
                .unwrap()
                .operation
                .as_deref(),
            Some("rebase")
        );
        assert!(edit(&repo, GitReferenceAction::CreateBranch, "other").is_err());
        edit(&repo, GitReferenceAction::AbortRebase, "").unwrap();
        let snapshot = repo.runner().snapshot().unwrap().unwrap();
        assert!(snapshot.operation.is_none());
        assert!(snapshot.entries.is_empty());
        let head = repo.runner().checked(&["rev-parse", "HEAD"], 4096).unwrap();
        assert_eq!(String::from_utf8_lossy(&head).trim(), before);
    }
    #[test]
    fn staged_resolution_allows_a_conflicting_rebase_to_continue() {
        let repo = base();
        repo.git(&["switch", "-c", "feature"]);
        repo.write("file.txt", "feature\n");
        repo.git(&["commit", "-am", "feature"]);
        repo.git(&["switch", "main"]);
        repo.write("file.txt", "main\n");
        repo.git(&["commit", "-am", "main"]);
        assert!(edit(&repo, GitReferenceAction::Rebase, "refs/heads/feature").is_err());
        repo.write("file.txt", "combined resolution\n");
        repo.runner()
            .change("file.txt", super::super::GitAction::Resolve)
            .unwrap();
        edit(&repo, GitReferenceAction::ContinueRebase, "").unwrap();
        let snapshot = repo.runner().snapshot().unwrap().unwrap();
        assert!(snapshot.operation.is_none());
        assert!(snapshot.entries.is_empty());
    }
}
