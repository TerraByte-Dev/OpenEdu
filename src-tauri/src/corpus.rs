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

// The pure halves below take plain data rather than `tauri::State`, so they can be tested without a
// running app. The commands lock the grant list, copy what they need and delegate.

/// A canonicalised target must be the granted root or live beneath it.
pub(crate) fn is_granted(roots: &[PathBuf], target: &Path) -> bool {
    roots.iter().any(|r| target == r || target.starts_with(r))
}

/// Canonicalise first, then check: the order is what stops `..` and symlinks from escaping a root.
pub(crate) fn resolve_granted(roots: &[PathBuf], raw: &str) -> Result<PathBuf, String> {
    let target = canonical(raw)?;
    if is_granted(roots, &target) {
        Ok(target)
    } else {
        Err("path is outside every granted folder".into())
    }
}

pub(crate) fn grant(roots: &mut Vec<PathBuf>, raw: &str) -> Result<PathBuf, String> {
    let root = canonical(raw)?;
    if !root.is_dir() {
        return Err("not a folder".into());
    }
    if !roots.contains(&root) {
        roots.push(root.clone());
    }
    Ok(root)
}

/// Breadth-first walk from an already-granted, canonical `start`.
///
/// Breadth-first on purpose: an archive's useful files are usually near the top, so a truncated
/// walk still returns something representative rather than the deepest corner of one subtree.
/// Symlinked directories are not followed — that is how a walk over a real archive ends up in a
/// cycle, or silently outside the root.
pub(crate) fn walk(start: &Path, max: usize, exts: &[String]) -> Listing {
    let want: Vec<String> = exts.iter().map(|e| e.trim_start_matches('.').to_lowercase()).collect();
    let cap = max.clamp(1, 200_000);

    let mut entries = Vec::new();
    let mut skipped = Vec::new();
    let mut queue = VecDeque::from([start.to_path_buf()]);
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

    Listing { root: start.to_string_lossy().into_owned(), entries, truncated, skipped }
}

/// Read an already-granted, canonical text file, capped.
///
/// The cap is not politeness — a 3.9 GB PDF read into a String would take the process down, and an
/// archive contains files like that. Invalid UTF-8 is replaced rather than erroring, because a
/// single bad byte in one file must not fail an import of thousands.
pub(crate) fn read_text_capped(target: &Path, max_bytes: usize) -> Result<String, String> {
    let meta = fs::metadata(target).map_err(|e| format!("cannot stat file: {e}"))?;
    if !meta.is_file() {
        return Err("not a file".into());
    }
    let cap = max_bytes.clamp(1, 64 * 1024 * 1024) as u64;
    if meta.len() > cap {
        return Err(format!("file is {} bytes, over the {} byte cap", meta.len(), cap));
    }
    let bytes = fs::read(target).map_err(|e| format!("cannot read file: {e}"))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn granted_roots(state: &State<Granted>) -> Result<Vec<PathBuf>, String> {
    state.0.lock().map(|r| r.clone()).map_err(|_| "grant list poisoned".to_string())
}

/// Trust a folder for this session. The UI calls this with whatever the folder picker returned.
#[tauri::command]
pub fn corpus_grant(path: String, state: State<Granted>) -> Result<String, String> {
    let mut roots = state.0.lock().map_err(|_| "grant list poisoned".to_string())?;
    grant(&mut roots, &path).map(|r| r.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn corpus_granted(state: State<Granted>) -> Result<Vec<String>, String> {
    let roots = state.0.lock().map_err(|_| "grant list poisoned".to_string())?;
    Ok(roots.iter().map(|r| r.to_string_lossy().into_owned()).collect())
}

/// Breadth-first walk under a granted root. See `walk`.
#[tauri::command]
pub fn corpus_list(
    root: String,
    max: usize,
    exts: Vec<String>,
    state: State<Granted>,
) -> Result<Listing, String> {
    let start = resolve_granted(&granted_roots(&state)?, &root)?;
    Ok(walk(&start, max, &exts))
}

/// Read a text file under a granted root, capped. See `read_text_capped`.
#[tauri::command]
pub fn corpus_read_text(path: String, max_bytes: usize, state: State<Granted>) -> Result<String, String> {
    let target = resolve_granted(&granted_roots(&state)?, &path)?;
    read_text_capped(&target, max_bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use tempfile::TempDir;

    // Canonical from the start: on Windows temp_dir() can be an 8.3 short path, and canonicalize
    // returns \\?\C:\... — never compare canonical output with hand-built strings.
    fn tmp() -> (TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        (dir, root)
    }

    fn touch(path: &Path, bytes: &[u8]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, bytes).unwrap();
    }

    fn s(p: &Path) -> &str {
        p.to_str().unwrap()
    }

    fn names(listing: &Listing) -> Vec<String> {
        let mut n: Vec<String> = listing.entries.iter().map(|e| e.name.clone()).collect();
        n.sort();
        n
    }

    #[test]
    fn grant_rejects_a_file() {
        let (_d, root) = tmp();
        let file = root.join("a.txt");
        touch(&file, b"x");
        let mut roots = Vec::new();
        assert_eq!(grant(&mut roots, s(&file)), Err("not a folder".to_string()));
        assert!(roots.is_empty());
    }

    #[test]
    fn regrant_does_not_duplicate_even_via_another_spelling() {
        let (_d, root) = tmp();
        fs::create_dir(root.join("sub")).unwrap();
        let mut roots = Vec::new();
        assert_eq!(grant(&mut roots, s(&root)).unwrap(), root);
        assert_eq!(grant(&mut roots, s(&root.join("sub").join(".."))).unwrap(), root);
        assert_eq!(roots, vec![root]);
    }

    #[test]
    fn root_and_its_descendants_are_granted() {
        let (_d, root) = tmp();
        let file = root.join("deep").join("a.txt");
        touch(&file, b"x");
        let roots = vec![root.clone()];
        assert_eq!(resolve_granted(&roots, s(&root)).unwrap(), root);
        assert_eq!(resolve_granted(&roots, s(&file)).unwrap(), file);
    }

    #[test]
    fn dotdot_escape_is_rejected_after_canonicalisation() {
        let (_d, base) = tmp();
        let root = base.join("inner");
        fs::create_dir(&root).unwrap();
        touch(&base.join("secret.txt"), b"x");
        // Built as a string from the plain (non-\\?\) form a folder picker returns: PathBuf::push
        // collapses `..` on a \\?\ path, and Windows won't resolve `..` inside one at all. Textually
        // this is under the root; only canonicalising before the check catches it.
        let plain = s(&root).trim_start_matches(r"\\?\");
        let raw = format!("{plain}{sep}..{sep}secret.txt", sep = std::path::MAIN_SEPARATOR);
        assert_eq!(
            resolve_granted(&[root], &raw),
            Err("path is outside every granted folder".to_string())
        );
    }

    #[test]
    fn sibling_with_the_root_as_a_string_prefix_is_not_granted() {
        let (_d, base) = tmp();
        let root = base.join("lib");
        let evil = base.join("lib-evil").join("a.txt");
        fs::create_dir(&root).unwrap();
        touch(&evil, b"x");
        assert!(!is_granted(&[root.clone()], &evil));
        assert!(resolve_granted(&[root], s(&evil)).is_err());
    }

    #[test]
    fn a_path_that_does_not_exist_cannot_be_resolved() {
        let (_d, root) = tmp();
        let err = resolve_granted(&[root.clone()], s(&root.join("missing.txt"))).unwrap_err();
        assert!(err.starts_with("cannot resolve path:"), "{err}");
    }

    #[test]
    fn extension_filter_is_case_insensitive_and_ignores_the_dot() {
        let (_d, root) = tmp();
        touch(&root.join("a.MD"), b"x");
        touch(&root.join("b.md"), b"x");
        touch(&root.join("c.txt"), b"x");
        touch(&root.join("noext"), b"x");
        let listing = walk(&root, 100, &[".MD".to_string()]);
        assert_eq!(names(&listing), vec!["a.MD", "b.md"]);
        assert!(listing.entries.iter().all(|e| e.ext == "md"));
        assert_eq!(names(&walk(&root, 100, &["md".to_string()])), vec!["a.MD", "b.md"]);
        assert_eq!(walk(&root, 100, &[]).entries.len(), 4);
    }

    #[test]
    fn truncated_only_when_a_match_is_left_over() {
        let (_d, root) = tmp();
        for n in ["a", "b", "c"] {
            touch(&root.join(format!("{n}.txt")), b"x");
        }
        let exact = walk(&root, 3, &[]);
        assert_eq!(exact.entries.len(), 3);
        assert!(!exact.truncated);

        touch(&root.join("d.txt"), b"x");
        let over = walk(&root, 3, &[]);
        assert_eq!(over.entries.len(), 3);
        assert!(over.truncated);
    }

    #[test]
    fn filtered_out_files_do_not_count_towards_the_cap() {
        let (_d, root) = tmp();
        touch(&root.join("a.md"), b"x");
        touch(&root.join("b.txt"), b"x");
        touch(&root.join("c.txt"), b"x");
        let listing = walk(&root, 1, &["md".to_string()]);
        assert_eq!(names(&listing), vec!["a.md"]);
        assert!(!listing.truncated);
    }

    #[test]
    fn max_zero_clamps_to_one() {
        let (_d, root) = tmp();
        touch(&root.join("a.txt"), b"x");
        touch(&root.join("b.txt"), b"x");
        let listing = walk(&root, 0, &[]);
        assert_eq!(listing.entries.len(), 1);
        assert!(listing.truncated);
    }

    #[test]
    fn walk_is_breadth_first() {
        let (_d, root) = tmp();
        touch(&root.join("sub").join("nested.txt"), b"x");
        touch(&root.join("top.txt"), b"x");
        let listing = walk(&root, 1, &[]);
        assert_eq!(names(&listing), vec!["top.txt"]);
        assert!(listing.truncated);
    }

    #[test]
    fn walk_reports_the_root_and_full_paths() {
        let (_d, root) = tmp();
        let file = root.join("sub").join("a.txt");
        touch(&file, b"hello");
        let listing = walk(&root, 10, &[]);
        assert_eq!(listing.root, root.to_string_lossy());
        assert_eq!(listing.entries.len(), 1);
        assert_eq!(listing.entries[0].path, file.to_string_lossy());
        assert_eq!(listing.entries[0].bytes, 5);
        assert!(listing.skipped.is_empty());
    }

    #[test]
    fn a_walk_start_that_cannot_be_read_is_skipped_not_fatal() {
        let (_d, root) = tmp();
        let gone = root.join("gone");
        let listing = walk(&gone, 10, &[]);
        assert!(listing.entries.is_empty());
        assert_eq!(listing.skipped, vec![gone.to_string_lossy().into_owned()]);
    }

    #[test]
    fn reads_a_file_under_the_cap() {
        let (_d, root) = tmp();
        let file = root.join("a.txt");
        touch(&file, "héllo".as_bytes());
        assert_eq!(read_text_capped(&file, 1024).unwrap(), "héllo");
    }

    #[test]
    fn max_bytes_zero_clamps_to_one() {
        let (_d, root) = tmp();
        let one = root.join("one.txt");
        let two = root.join("two.txt");
        touch(&one, b"x");
        touch(&two, b"xy");
        assert_eq!(read_text_capped(&one, 0).unwrap(), "x");
        assert_eq!(read_text_capped(&two, 0), Err("file is 2 bytes, over the 1 byte cap".to_string()));
    }

    #[test]
    fn a_file_over_the_cap_is_refused() {
        let (_d, root) = tmp();
        let file = root.join("big.txt");
        touch(&file, &[b'x'; 11]);
        assert_eq!(read_text_capped(&file, 10), Err("file is 11 bytes, over the 10 byte cap".to_string()));
        assert_eq!(read_text_capped(&file, 11).unwrap().len(), 11);
    }

    #[test]
    fn invalid_utf8_is_replaced_not_an_error() {
        let (_d, root) = tmp();
        let file = root.join("bad.txt");
        touch(&file, b"ok \xff\xfe end");
        assert_eq!(read_text_capped(&file, 1024).unwrap(), "ok \u{FFFD}\u{FFFD} end");
    }

    #[test]
    fn a_directory_is_not_a_file() {
        let (_d, root) = tmp();
        assert_eq!(read_text_capped(&root, 1024), Err("not a file".to_string()));
    }

    // Automates the HANDOFF verify step ("a 3.9 GB file must not crash"). set_len is sparse on
    // Linux/macOS; on NTFS it reserves the space without writing it.
    #[test]
    fn a_4gb_file_is_refused_without_being_read() {
        let (_d, root) = tmp();
        let file = root.join("huge.bin");
        File::create(&file).unwrap().set_len(4_000_000_000).unwrap();
        assert_eq!(
            read_text_capped(&file, 64 * 1024 * 1024),
            Err("file is 4000000000 bytes, over the 67108864 byte cap".to_string())
        );
        // The cap is clamped too, so asking for more doesn't lift it.
        assert!(read_text_capped(&file, usize::MAX).unwrap_err().contains("over the 67108864 byte cap"));
    }

    // A junction needs no Developer Mode, unlike a symlink, so it's what an ordinary Windows user
    // can have in an archive.
    #[cfg(windows)]
    #[test]
    fn a_junction_out_of_the_root_is_neither_walked_nor_readable() {
        let (_d, base) = tmp();
        let root = base.join("root");
        let outside = base.join("outside");
        touch(&root.join("mine.txt"), b"x");
        touch(&outside.join("secret.txt"), b"x");
        let link = root.join("inside");
        let out = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(&link)
            .arg(&outside)
            .output()
            .unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stdout));

        assert_eq!(names(&walk(&root, 100, &[])), vec!["mine.txt"]);
        assert_eq!(
            resolve_granted(&[root.clone()], s(&link.join("secret.txt"))),
            Err("path is outside every granted folder".to_string())
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_out_of_the_root_is_neither_walked_nor_readable() {
        let (_d, base) = tmp();
        let root = base.join("root");
        let outside = base.join("outside");
        touch(&root.join("mine.txt"), b"x");
        touch(&outside.join("secret.txt"), b"x");
        let link = root.join("inside");
        std::os::unix::fs::symlink(&outside, &link).unwrap();

        assert_eq!(names(&walk(&root, 100, &[])), vec!["mine.txt"]);
        assert_eq!(
            resolve_granted(&[root.clone()], s(&link.join("secret.txt"))),
            Err("path is outside every granted folder".to_string())
        );
    }

    // The canonical tempdir is already a \\?\ verbatim path, which is what lets std go past
    // MAX_PATH. Everything corpus.rs touches after a grant is canonical, so this is the real case.
    #[cfg(windows)]
    #[test]
    fn paths_over_260_chars_work_end_to_end() {
        let (_d, base) = tmp();
        let mut deep = base.clone();
        while deep.as_os_str().len() <= 300 {
            deep.push("a_fairly_long_directory_name_0123456789");
        }
        let file = deep.join("deep.txt");
        touch(&file, b"deep");
        assert!(s(&file).len() > 260);

        let mut roots = Vec::new();
        grant(&mut roots, s(&base)).unwrap();
        let listing = walk(&base, 10, &[]);
        assert_eq!(names(&listing), vec!["deep.txt"]);
        let target = resolve_granted(&roots, &listing.entries[0].path).unwrap();
        assert_eq!(read_text_capped(&target, 1024).unwrap(), "deep");
    }
}
