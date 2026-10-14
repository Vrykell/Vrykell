//! grants — the paths an operating-system gesture handed to the app.
//!
//! Reading a file the page names is only allowed when the path came from somewhere the page cannot
//! fake: a native picker driven from Rust (see [`pick_path`]), or a drop the operating system
//! delivered to the window (recorded in `lib.rs`). The app's own directories are always readable.
//! Grants are persisted so a wallpaper or a re-opened conversation keeps working across restarts.
//!
//! This is the same idea as a resource-root allow list: the renderer names paths, Rust decides
//! whether the user ever pointed at them.

use serde::Deserialize;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, FilePath};

/// Directories the app owns: their contents need no gesture (attachments are re-read when a
/// conversation is restored, skills are read by the agent's own gated tools).
fn own_dirs() -> Vec<PathBuf> {
    let root = dirs::home_dir().unwrap_or_default().join(".vrykell");
    vec![root.join("attachments"), root.join("skills")]
}

/// Where the approved list lives.
fn grants_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".vrykell")
        .join("approved-paths.json")
}

/// Canonicalize for comparison. A path that does not exist yet (a save target) resolves through
/// its parent, so the answer is still a real location rather than a string the page chose.
fn canonical_lenient(path: &Path) -> Option<PathBuf> {
    if let Ok(existing) = std::fs::canonicalize(path) {
        return Some(existing);
    }
    let parent = path.parent()?;
    let name = path.file_name()?;
    std::fs::canonicalize(parent).ok().map(|base| base.join(name))
}

/// `candidate` is `root` itself or sits underneath it.
fn is_under(candidate: &Path, root: &Path) -> bool {
    candidate == root || candidate.starts_with(root)
}

pub struct PathGrants(Mutex<BTreeSet<PathBuf>>);

impl PathGrants {
    /// Load the persisted list, dropping entries whose file is gone.
    pub fn load() -> Self {
        let approved = std::fs::read_to_string(grants_path())
            .ok()
            .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
            .map(|paths| {
                paths
                    .into_iter()
                    .map(PathBuf::from)
                    .filter(|path| path.exists())
                    .collect()
            })
            .unwrap_or_default();
        Self(Mutex::new(approved))
    }

    fn persist(&self, set: &BTreeSet<PathBuf>) {
        let path = grants_path();
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let list: Vec<String> = set
            .iter()
            .map(|entry| entry.to_string_lossy().to_string())
            .collect();
        if let Ok(json) = serde_json::to_string_pretty(&list) {
            let _ = std::fs::write(path, json);
        }
    }

    /// Record paths a gesture produced and answer with the canonical ones that were kept.
    pub fn grant(&self, paths: impl IntoIterator<Item = PathBuf>) -> Vec<PathBuf> {
        let kept = self.grant_in_memory(paths);
        if let Ok(set) = self.0.lock() {
            self.persist(&set);
        }
        kept
    }

    /// The bookkeeping half of [`Self::grant`], without touching the approval file (tests use it).
    fn grant_in_memory(&self, paths: impl IntoIterator<Item = PathBuf>) -> Vec<PathBuf> {
        let mut kept = Vec::new();
        let Ok(mut set) = self.0.lock() else {
            return kept;
        };
        for path in paths {
            if let Some(canonical) = canonical_lenient(&path) {
                if set.insert(canonical.clone()) {
                    kept.push(canonical);
                }
            }
        }
        kept
    }

    /// May the page read this path? Inside an app directory, or inside something the user granted.
    pub fn allows(&self, path: &Path) -> bool {
        self.allows_with(&own_dirs(), path)
    }

    fn allows_with(&self, own: &[PathBuf], path: &Path) -> bool {
        let Some(candidate) = canonical_lenient(path) else {
            return false;
        };
        // Both sides are canonicalized: on Windows the canonical form carries a \\?\ prefix, so a
        // plain temp path would never prefix-match without this.
        if own
            .iter()
            .filter_map(|dir| canonical_lenient(dir))
            .any(|dir| is_under(&candidate, &dir))
        {
            return true;
        }
        match self.0.lock() {
            // Fail closed: an unusable lock must not widen access.
            Err(_) => false,
            Ok(set) => set.iter().any(|root| is_under(&candidate, root)),
        }
    }
}

/// What the page asks for. Extensions are bare (`png`), not dotted.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PickRequest {
    /// `file` (default), `files`, `directory` or `save`.
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub extensions: Option<Vec<String>>,
    #[serde(default)]
    pub file_name: Option<String>,
}

/// Open a native picker here, in Rust, and record what the user chose.
///
/// The picker could have stayed in the page (the dialog plugin is reachable from there), but then
/// nothing would know the choice came from a gesture. Running it here is what makes the grant
/// trustworthy: the page receives paths, never the authority to name them.
#[tauri::command]
pub async fn pick_path(
    app: AppHandle,
    state: tauri::State<'_, PathGrants>,
    request: PickRequest,
) -> Result<Vec<String>, String> {
    let mut dialog = app.dialog().file();
    if let Some(extensions) = request.extensions.filter(|list| !list.is_empty()) {
        let borrowed: Vec<&str> = extensions.iter().map(String::as_str).collect();
        dialog = dialog.add_filter("Files", &borrowed);
    }
    if let Some(name) = request.file_name.filter(|name| !name.is_empty()) {
        dialog = dialog.set_file_name(name);
    }
    let mode = request.mode.unwrap_or_else(|| "file".to_string());

    // Both converters capture nothing, so each callback below takes its own copy.
    let to_paths = |files: Option<Vec<FilePath>>| -> Vec<PathBuf> {
        files
            .unwrap_or_default()
            .into_iter()
            .filter_map(|file| file.into_path().ok())
            .collect()
    };
    let one = move |path: Option<FilePath>| -> Vec<PathBuf> { to_paths(path.map(|file| vec![file])) };

    let (tx, rx) = tokio::sync::oneshot::channel::<Vec<PathBuf>>();
    if mode == "files" {
        dialog.pick_files(move |paths| {
            let _ = tx.send(to_paths(paths));
        });
    } else {
        let single = move |path: Option<FilePath>| {
            let _ = tx.send(one(path));
        };
        match mode.as_str() {
            "directory" => dialog.pick_folder(single),
            "save" => dialog.save_file(single),
            _ => dialog.pick_file(single),
        }
    }
    let picked = rx.await.unwrap_or_default();
    Ok(granted_paths(&state, picked))
}

/// Record what the gesture produced and answer with the canonical paths that were kept.
fn granted_paths(state: &tauri::State<'_, PathGrants>, picked: Vec<PathBuf>) -> Vec<String> {
    state
        .grant(picked)
        .into_iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grants(paths: &[&Path]) -> PathGrants {
        let registry = PathGrants(Mutex::new(BTreeSet::new()));
        // Granted through the public path, so the same canonicalizing the runtime uses applies.
        registry.grant_in_memory(paths.iter().map(|p| p.to_path_buf()));
        registry
    }

    #[test]
    fn a_granted_file_is_readable_and_its_neighbours_are_not() {
        let dir = std::env::temp_dir().join("vrykell-grants-file");
        std::fs::create_dir_all(&dir).unwrap();
        let chosen = dir.join("chosen.txt");
        let sibling = dir.join("sibling.txt");
        std::fs::write(&chosen, b"x").unwrap();
        std::fs::write(&sibling, b"y").unwrap();

        let registry = grants(&[&chosen]);
        assert!(registry.allows_with(&[], &chosen), "the picked file itself");
        assert!(!registry.allows_with(&[], &sibling), "a sibling is a different file");
    }

    #[test]
    fn a_granted_directory_covers_its_subtree() {
        let dir = std::env::temp_dir().join("vrykell-grants-dir");
        let nested = dir.join("nested");
        std::fs::create_dir_all(&nested).unwrap();
        let inside = nested.join("file.txt");
        std::fs::write(&inside, b"x").unwrap();

        let registry = grants(&[&dir]);
        assert!(registry.allows_with(&[], &dir), "the directory itself");
        assert!(registry.allows_with(&[], &inside), "a file below it");
        assert!(
            !registry.allows_with(&[], Path::new("/definitely/not/granted.txt")),
            "an unrelated path stays out"
        );
    }

    #[test]
    fn app_owned_directories_need_no_gesture() {
        let root = std::env::temp_dir().join("vrykell-grants-own");
        let attachments = root.join("attachments");
        std::fs::create_dir_all(&attachments).unwrap();
        let stored = attachments.join("paste-1.png");
        std::fs::write(&stored, b"x").unwrap();
        let elsewhere = root.join("elsewhere.txt");
        std::fs::write(&elsewhere, b"y").unwrap();

        let registry = grants(&[]);
        assert!(registry.allows_with(&[attachments.clone()], &stored));
        assert!(
            !registry.allows_with(&[attachments], &elsewhere),
            "a path outside the app directory has no grant"
        );
    }

    #[test]
    fn granting_returns_canonical_paths_and_ignores_the_rest() {
        let dir = std::env::temp_dir().join("vrykell-grants-add");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("added.txt");
        std::fs::write(&file, b"x").unwrap();

        let registry = grants(&[]);
        let kept = registry.grant_in_memory(vec![file.clone(), PathBuf::from("/does/not/exist.txt")]);
        assert_eq!(kept.len(), 1, "only the path that exists is kept");
        assert!(kept[0].is_absolute(), "the kept path is absolute");
    }
}
