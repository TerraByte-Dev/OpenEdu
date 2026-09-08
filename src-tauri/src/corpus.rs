//! Read-only filesystem access, scoped to folders the user explicitly picked.
//!
//! Before this module the app had NO filesystem access of any kind: five plugins (sql, http, store,
//! process, updater), no `fs:` permission, and zero `#[tauri::command]` functions. The only way a
//! byte could enter was an HTML `<input type="file">` filtered to three text extensions. "Point
//! OpenEdu at a folder" was not a missing feature, it was a capability the Rust layer never had.
//!
//! Deliberately NOT `tauri-plugin-fs`. That grants a path allow-list decided at build time; what
//! this product needs is a root the user chooses at runtime, and nothing outside it. So:
//!
//!   * every root is canonicalised at grant time, which resolves `..`, symlinks and 8.3 short names
//!     BEFORE it is trusted;
//!   * every read and every walk canonicalises its target and proves it is under a granted root, so
//!     a later symlink cannot escape;
//!   * everything here is read-only. There is no write command and no delete command.

use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::State;

/// Roots the user picked this session. Not persisted — a restart re-asks, which is the safe default.
#[derive(Default)]
pub struct Granted(pub Mutex<Vec<PathBuf>>);

#[derive(Serialize)]
pub struct Entry {
    pub path: String,
    pub name: String,
    /// Lowercased, no dot. Empty when the file has no extension.
    pub ext: String,
    pub bytes: u64,
}

#[derive(Serialize)]
pub struct Listing {
    pub root: String,
    pub entries: Vec<Entry>,
    /// True when the walk stopped at `max`. The caller must surface this — a silently truncated
    /// listing reads as "this is everything", which is exactly the lie that makes a corpus tool
    /// untrustworthy.
    pub truncated: bool,
    /// Directories that could not be read (permissions, a disconnected drive). Reported, not fatal:
    /// one unreadable folder must never abort a walk over an archive.
    pub skipped: Vec<String>,
}

fn canonical(p: &str) -> Result<PathBuf, String> {
    fs::canonicalize(p).map_err(|e| format!("cannot resolve path: {e}"))
}

/// A canonicalised target must be the granted root or live beneath it.
fn ensure_granted(state: &State<Granted>, target: &Path) -> Result<(), String> {
    let roots = state.0.lock().map_err(|_| "grant list poisoned".to_string())?;
    if roots.iter().any(|r| target == r || target.starts_with(r)) {
        Ok(())
    } else {
        Err("path is outside every granted folder".into())
    }
}

/// Trust a folder for this session. The UI calls this with whatever the folder picker returned.
#[tauri::command]
pub fn corpus_grant(path: String, state: State<Granted>) -> Result<String, String> {
    let root = canonical(&path)?;
    if !root.is_dir() {
        return Err("not a folder".into());
    }
    let mut roots = state.0.lock().map_err(|_| "grant list poisoned".to_string())?;
    if !roots.contains(&root) {
        roots.push(root.clone());
    }
    Ok(root.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn corpus_granted(state: State<Granted>) -> Result<Vec<String>, String> {
    let roots = state.0.lock().map_err(|_| "grant list poisoned".to_string())?;
    Ok(roots.iter().map(|r| r.to_string_lossy().into_owned()).collect())
}

/// Breadth-first walk under a granted root.
///
/// Breadth-first on purpose: an archive's useful files are usually near the top, so a truncated
/// walk still returns something representative rather than the deepest corner of one subtree.
/// Symlinked directories are not followed — that is how a walk over a real archive ends up in a
/// cycle, or silently outside the root.
#[tauri::command]
pub fn corpus_list(
    root: String,
    max: usize,
    exts: Vec<String>,
    state: State<Granted>,
) -> Result<Listing, String> {
    let start = canonical(&root)?;
    ensure_granted(&state, &start)?;

    let want: Vec<String> = exts.iter().map(|e| e.trim_start_matches('.').to_lowercase()).collect();
    let cap = max.clamp(1, 200_000);

    let mut entries = Vec::new();
    let mut skipped = Vec::new();
    let mut queue = VecDeque::from([start.clone()]);
    let mut truncated = false;

    while let Some(dir) = queue.pop_front() {
        let read = match fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => {
                skipped.push(dir.to_string_lossy().into_owned());
                continue;
            }
        };
        for item in read.flatten() {
            let path = item.path();
            let meta = match item.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.is_symlink() {
                continue;
            }
            if meta.is_dir() {
                queue.push_back(path);
                continue;
            }
            let ext = path
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if !want.is_empty() && !want.contains(&ext) {
                continue;
            }
            if entries.len() >= cap {
                truncated = true;
                break;
            }
            entries.push(Entry {
                name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                path: path.to_string_lossy().into_owned(),
                ext,
                bytes: meta.len(),
            });
        }
        if truncated {
            break;
        }
    }

    Ok(Listing { root: start.to_string_lossy().into_owned(), entries, truncated, skipped })
}

/// Read a text file under a granted root, capped.
///
/// The cap is not politeness — a 3.9 GB PDF read into a String would take the process down, and an
/// archive contains files like that. Invalid UTF-8 is replaced rather than erroring, because a
/// single bad byte in one file must not fail an import of thousands.
#[tauri::command]
pub fn corpus_read_text(path: String, max_bytes: usize, state: State<Granted>) -> Result<String, String> {
    let target = canonical(&path)?;
    ensure_granted(&state, &target)?;

    let meta = fs::metadata(&target).map_err(|e| format!("cannot stat file: {e}"))?;
    if !meta.is_file() {
        return Err("not a file".into());
    }
    let cap = max_bytes.clamp(1, 64 * 1024 * 1024) as u64;
    if meta.len() > cap {
        return Err(format!("file is {} bytes, over the {} byte cap", meta.len(), cap));
    }
    let bytes = fs::read(&target).map_err(|e| format!("cannot read file: {e}"))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}
