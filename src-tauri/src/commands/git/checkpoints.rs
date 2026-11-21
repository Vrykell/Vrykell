use super::{GitTarget, Runner, MAX_STATUS};
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::fs::{self, File, OpenOptions, Permissions};
use std::io::{ErrorKind, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{LazyLock, Mutex};

const CAP: usize = 64 * 1024 * 1024;
const CHANGED: &str = "A file changed after this turn. Refresh the workspace before restoring.";
type Snapshot = BTreeMap<PathBuf, Image>;
struct Baseline {
    files: Snapshot,
    ignored: HashSet<PathBuf>,
}
#[derive(Clone)]
struct Image {
    data: Vec<u8>,
    mode: Permissions,
}
impl PartialEq for Image {
    fn eq(&self, other: &Self) -> bool {
        self.data == other.data && self.mode == other.mode
    }
}
struct Delta {
    file: PathBuf,
    before: Option<Image>,
    after: Option<Image>,
}
struct Checkpoint {
    key: String,
    root: PathBuf,
    files: Vec<Delta>,
    size: usize,
}
#[derive(Default)]
struct Journal {
    active: HashMap<String, (PathBuf, Option<Baseline>)>,
    ready: VecDeque<Checkpoint>,
}
static JOURNAL: LazyLock<Mutex<Journal>> = LazyLock::new(|| Mutex::new(Journal::default()));

fn io(e: std::io::Error) -> String {
    e.to_string()
}

fn file_path(root: &Path, name: &Path) -> Result<PathBuf, String> {
    let mut path = root.to_path_buf();
    if path.canonicalize().map_err(io)? != root {
        return Err(CHANGED.into());
    }
    for part in name.components() {
        let Component::Normal(segment) = part else {
            return Err("Invalid checkpoint path".into());
        };
        if segment.eq_ignore_ascii_case(".git") {
            return Err("Invalid checkpoint path".into());
        }
        path.push(segment);
        match fs::symlink_metadata(&path) {
            Ok(m) => {
                #[cfg(windows)]
                let linked = std::os::windows::fs::MetadataExt::file_attributes(&m) & 0x400 != 0;
                #[cfg(not(windows))]
                let linked = m.file_type().is_symlink();
                if linked {
                    return Err("Links cannot be restored from a checkpoint".into());
                }
            }
            Err(e) if e.kind() == ErrorKind::NotFound => (),
            Err(e) => return Err(io(e)),
        }
    }
    Ok(path)
}

fn read_image(path: &Path, remaining: usize) -> Result<Option<Image>, String> {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(io(e)),
    };
    if !meta.is_file() || meta.len() > remaining as u64 {
        return Err("Workspace exceeds the checkpoint scope".into());
    }
    let mut data = Vec::new();
    File::open(path)
        .map_err(io)?
        .take(remaining as u64 + 1)
        .read_to_end(&mut data)
        .map_err(io)?;
    if data.len() > remaining {
        return Err("Workspace exceeds the checkpoint size limit".into());
    }
    Ok(Some(Image {
        data,
        mode: meta.permissions(),
    }))
}

fn snapshot(root: &Path) -> Result<Snapshot, String> {
    let runner = Runner::new(
        GitTarget {
            cwd: root.to_string_lossy().into(),
            connection_id: None,
        },
        None,
    )?;
    let names = runner.checked(
        &[
            "-c",
            "core.fsmonitor=false",
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
            "--",
            ".",
        ],
        MAX_STATUS,
    )?;
    let mut files = BTreeMap::new();
    let mut remaining = CAP;
    for raw in names.split(|&b| b == 0).filter(|p| !p.is_empty()) {
        let name =
            PathBuf::from(std::str::from_utf8(raw).map_err(|_| "Unsupported checkpoint filename")?);
        if files.contains_key(&name) {
            continue;
        }
        if files.len() >= 16_384 {
            return Err("Workspace exceeds the checkpoint file limit".into());
        }
        if let Some(image) = read_image(&file_path(root, &name)?, remaining)? {
            remaining -= image.data.len();
            files.insert(name, image);
        }
    }
    Ok(files)
}

impl Journal {
    fn begin(&mut self, key: String, root: PathBuf) -> Result<bool, String> {
        if self.active.contains_key(&key)
            || !root.is_absolute()
            || key.is_empty()
            || key.len() > 512
        {
            return Err("Invalid checkpoint".into());
        }
        let root = root.canonicalize().map_err(io)?;
        let mut overlap = false;
        for (other, baseline) in self.active.values_mut() {
            if root.starts_with(&other) || other.starts_with(&root) {
                *baseline = None;
                overlap = true;
            }
        }
        if self.active.len() >= 4 {
            return Err("Too many active checkpoints".into());
        }
        let before = if overlap {
            None
        } else {
            let runner = Runner::new(
                GitTarget {
                    cwd: root.to_string_lossy().into(),
                    connection_id: None,
                },
                None,
            )?;
            let raw = runner.checked(
                &[
                    "-c",
                    "core.fsmonitor=false",
                    "ls-files",
                    "--others",
                    "--ignored",
                    "--exclude-standard",
                    "--directory",
                    "-z",
                    "--",
                    ".",
                ],
                MAX_STATUS,
            )?;
            let ignored = raw
                .split(|&b| b == 0)
                .filter(|p| !p.is_empty())
                .map(|p| {
                    std::str::from_utf8(p)
                        .map(PathBuf::from)
                        .map_err(|_| "Unsupported checkpoint filename")
                })
                .collect::<Result<HashSet<_>, _>>()?;
            Some(Baseline {
                files: snapshot(&root)?,
                ignored,
            })
        };
        self.active.insert(key, (root, before));
        Ok(true)
    }

    fn finish(&mut self, key: String) -> Result<Vec<String>, String> {
        let Some((
            root,
            Some(Baseline {
                files: mut before,
                ignored,
            }),
        )) = self.active.remove(&key)
        else {
            return Ok(Vec::new());
        };
        let mut files = Vec::new();
        for (file, current) in snapshot(&root)? {
            let previous = before.remove(&file);
            if previous.is_none() && file.ancestors().any(|p| ignored.contains(p)) {
                return Err("Ignore rules changed during the turn".into());
            }
            if previous.as_ref() != Some(&current) {
                files.push(Delta {
                    file,
                    before: previous,
                    after: Some(current),
                });
            }
        }
        for (file, previous) in before {
            if file_path(&root, &file)?.try_exists().map_err(io)? {
                return Err("Workspace membership changed during the turn".into());
            }
            files.push(Delta {
                file,
                before: Some(previous),
                after: None,
            });
        }
        files.sort_by(|a, b| a.file.cmp(&b.file));
        let names = files
            .iter()
            .map(|d| d.file.to_string_lossy().into_owned())
            .collect();
        if !files.is_empty() {
            let size = files
                .iter()
                .flat_map(|d| [&d.before, &d.after])
                .flatten()
                .map(|i| i.data.len())
                .sum();
            while self.ready.len() >= 48
                || self.ready.iter().map(|c| c.size).sum::<usize>() + size > 2 * CAP
            {
                if self.ready.pop_front().is_none() {
                    break;
                }
            }
            self.ready.push_back(Checkpoint {
                key,
                root,
                files,
                size,
            });
        }
        Ok(names)
    }

    fn restore(&mut self, key: &str) -> Result<(), String> {
        let index = self
            .ready
            .iter()
            .position(|c| c.key == key)
            .ok_or("This checkpoint has expired")?;
        let checkpoint = &self.ready[index];
        if self.active.values().any(|(root, _)| {
            root.starts_with(&checkpoint.root) || checkpoint.root.starts_with(root)
        }) {
            return Err("Another turn is using this workspace".into());
        }
        for change in &checkpoint.files {
            let path = file_path(&checkpoint.root, &change.file)?;
            let current = read_image(&path, CAP)?;
            if current != change.before && current != change.after {
                return Err(CHANGED.into());
            }
        }
        for change in &checkpoint.files {
            let path = file_path(&checkpoint.root, &change.file)?;
            let current = read_image(&path, CAP)?;
            if current == change.before {
                continue;
            }
            if current != change.after {
                return Err(CHANGED.into());
            }
            restore_file(&path, change)?;
        }
        self.ready.remove(index);
        Ok(())
    }
}

fn restore_file(path: &Path, change: &Delta) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid checkpoint file")?;
    fs::create_dir_all(parent).map_err(io)?;
    let unique = || parent.join(format!(".turn-{}", uuid::Uuid::new_v4()));
    let staged = unique();
    let displaced = unique();
    let apply = || -> Result<(), String> {
        if let Some(before) = &change.before {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&staged)
                .map_err(io)?;
            file.write_all(&before.data).map_err(io)?;
            file.set_permissions(before.mode.clone()).map_err(io)?;
        }
        if change.after.is_some() {
            fs::rename(path, &displaced).map_err(io)?;
            if read_image(&displaced, CAP)? != change.after {
                return Err(CHANGED.into());
            }
        }
        if change.before.is_some() {
            fs::hard_link(&staged, path).map_err(io)?;
        }
        Ok(())
    };
    let result = apply();
    if result.is_err() && displaced.exists() {
        fs::hard_link(&displaced, path).map_err(|_| {
            format!(
                "Restore interrupted. The previous file is at {}",
                displaced.display()
            )
        })?;
    }
    if displaced.exists() {
        fs::remove_file(displaced).map_err(io)?;
    }
    if staged.exists() {
        fs::remove_file(staged).map_err(io)?;
    }
    result
}

async fn with_journal<T: Send + 'static>(
    f: impl FnOnce(&mut Journal) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut journal = JOURNAL.lock().map_err(|_| "Checkpoint state unavailable")?;
        f(&mut journal)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn begin_turn_checkpoint(key: String, cwd: String) -> Result<bool, String> {
    with_journal(move |j| j.begin(key, PathBuf::from(cwd))).await
}
#[tauri::command]
pub async fn finish_turn_checkpoint(key: String, discard: bool) -> Result<Vec<String>, String> {
    with_journal(move |j| {
        if discard {
            j.active.remove(&key);
            Ok(Vec::new())
        } else {
            j.finish(key)
        }
    }).await
}
#[tauri::command]
pub async fn restore_turn_checkpoint(key: String) -> Result<(), String> {
    with_journal(move |j| j.restore(&key)).await
}

#[cfg(test)]
mod tests {
    use super::super::tests::Repository;
    use super::*;
    #[test]
    fn overlapping_turns_never_restore_each_others_writes() {
        let repo = Repository::new();
        let root = PathBuf::from(repo.runner().cwd);
        let mut j = Journal::default();
        j.begin("one".into(), root.clone()).unwrap();
        j.begin("two".into(), root).unwrap();
        repo.write("file", "both");
        assert!(j.finish("one".into()).unwrap().is_empty());
        assert!(j.finish("two".into()).unwrap().is_empty());
        assert!(j.restore("one").is_err());
    }
    #[test]
    fn changing_ignore_rules_cannot_remove_a_preexisting_file() {
        let repo = Repository::new();
        repo.write(".gitignore", "private.txt\n");
        repo.write("private.txt", "untouched");
        let mut j = Journal::default();
        j.begin("turn".into(), PathBuf::from(repo.runner().cwd))
            .unwrap();
        repo.write(".gitignore", "");
        assert!(j.finish("turn".into()).is_err());
        assert!(j.restore("turn").is_err());
        assert_eq!(
            fs::read(Path::new(&repo.runner().cwd).join("private.txt")).unwrap(),
            b"untouched"
        );
    }
    #[test]
    fn restore_checks_conflicts_before_replacing_files_and_preserves_staging() {
        let repo = Repository::new();
        repo.write("a", "staged");
        repo.git(&["add", "a"]);
        repo.write("a", "draft");
        repo.write("b", "old");
        let root = PathBuf::from(repo.runner().cwd);
        let mut journal = Journal::default();
        journal.begin("turn".into(), root.clone()).unwrap();
        repo.write("a", "agent");
        fs::remove_file(root.join("b")).unwrap();
        repo.write("c", "new");
        assert_eq!(journal.finish("turn".into()).unwrap(), ["a", "b", "c"]);
        repo.write("c", "manual");
        assert!(journal.restore("turn").is_err());
        assert_eq!(fs::read(root.join("a")).unwrap(), b"agent");
        repo.write("c", "new");
        journal.restore("turn").unwrap();
        assert_eq!(fs::read(root.join("a")).unwrap(), b"draft");
        assert_eq!(fs::read(root.join("b")).unwrap(), b"old");
        assert!(!root.join("c").exists());
        assert_eq!(
            repo.runner().checked(&["show", ":a"], 128).unwrap(),
            b"staged"
        );
    }
}
