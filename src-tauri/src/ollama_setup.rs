//! Guided Ollama setup (#275): is Ollama on this computer, and where is its installer on the stick?
//!
//! Two read-only questions, nothing else. The app never installs, launches or opens anything:
//!
//!   * `ollama_installed` checks whether Ollama's program file exists in the places its installers put
//!     it, plus every folder on PATH. Existence only; no file is opened.
//!   * `ollama_installer_pick` opens the folder picker in Rust, looks (three levels down, no symlinks or
//!     junctions) for files named like Ollama's installers, and returns the folder as text. Showing the
//!     path is deliberate: opening it in Explorer/Finder needs a shell or opener capability this app does
//!     not have, and adding one for a convenience would widen what the webview can do.

use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::AppHandle;

use crate::model_import::{display, pick_folder};

/// Where Ollama's own installers put the program, per platform. PATH is searched as well.
fn known_locations() -> Vec<PathBuf> {
    let mut out = Vec::new();
    #[cfg(windows)]
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        out.push(PathBuf::from(local).join("Programs").join("Ollama").join("ollama.exe"));
    }
    #[cfg(target_os = "macos")]
    {
        out.push(PathBuf::from("/Applications/Ollama.app"));
        if let Some(home) = std::env::var_os("HOME") {
            out.push(PathBuf::from(home).join("Applications").join("Ollama.app"));
        }
        out.push(PathBuf::from("/opt/homebrew/bin/ollama"));
    }
    #[cfg(unix)]
    {
        out.push(PathBuf::from("/usr/local/bin/ollama"));
        out.push(PathBuf::from("/usr/bin/ollama"));
    }
    out
}

pub(crate) fn exe_name() -> &'static str {
    if cfg!(windows) { "ollama.exe" } else { "ollama" }
}

/// True when any location exists, or any PATH folder holds the program.
pub(crate) fn installed_in(locations: &[PathBuf], path_var: Option<&std::ffi::OsStr>, exe: &str) -> bool {
    locations.iter().any(|p| p.exists())
        || path_var.is_some_and(|v| std::env::split_paths(v).any(|d| d.join(exe).is_file()))
}

/// Whether Ollama is installed on this computer. A custom install folder outside PATH reads as not
/// installed, so the UI words this as "we couldn't find it", never "it isn't there".
#[tauri::command]
pub fn ollama_installed() -> bool {
    installed_in(&known_locations(), std::env::var_os("PATH").as_deref(), exe_name())
}

/// File names Ollama's installers and archives use: OllamaSetup.exe, Ollama.dmg, Ollama-darwin.zip,
/// ollama-linux-amd64.tgz / .tar.zst, ollama-windows-amd64.zip. A browser's "(1)" suffix is fine. The
/// installed program itself (ollama.exe, "ollama app.exe") is not an installer.
pub(crate) fn is_ollama_installer(name: &str) -> bool {
    let n = name.to_lowercase();
    if !n.starts_with("ollama") || n == "ollama.exe" || n == "ollama app.exe" {
        return false;
    }
    [".exe", ".msi", ".dmg", ".zip", ".tgz", ".tar.gz", ".tar.zst", ".pkg"].iter().any(|e| n.ends_with(e))
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Installer {
    pub name: String,
    /// Where it is, as text the user can follow in their file manager.
    pub location: String,
    pub bytes: u64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InstallerFolder {
    pub folder: String,
    pub installers: Vec<Installer>,
}

/// Breadth-first, three levels deep, symlinks and junctions skipped.
pub(crate) fn find_installers(root: &Path) -> Vec<Installer> {
    let mut found = Vec::new();
    let mut queue = VecDeque::from([(root.to_path_buf(), 0usize)]);
    let mut seen = 0usize;
    while let Some((dir, depth)) = queue.pop_front() {
        let Ok(read) = fs::read_dir(&dir) else { continue };
        for e in read.flatten() {
            seen += 1;
            if seen > 20_000 || found.len() >= 20 {
                return found;
            }
            let Ok(m) = e.metadata() else { continue };
            if m.file_type().is_symlink() {
                continue;
            }
            let name = e.file_name().to_string_lossy().into_owned();
            if m.is_dir() && depth < 3 {
                queue.push_back((e.path(), depth + 1));
            } else if m.is_file() && is_ollama_installer(&name) {
                found.push(Installer { name, location: display(&dir), bytes: m.len() });
            }
        }
    }
    found.sort_by(|a, b| a.location.cmp(&b.location).then(a.name.cmp(&b.name)));
    found
}

/// Let the user point at the stick or folder that has Ollama's installer. `None` when they cancelled.
#[tauri::command]
pub async fn ollama_installer_pick(app: AppHandle) -> Result<Option<InstallerFolder>, String> {
    let Some(raw) = pick_folder(&app, "Choose the folder or USB stick with the Ollama installer").await? else {
        return Ok(None);
    };
    let root = fs::canonicalize(&raw).map_err(|_| "That folder can't be opened.".to_string())?;
    let scan_root = root.clone();
    let installers = tauri::async_runtime::spawn_blocking(move || find_installers(&scan_root))
        .await
        .map_err(|e| e.to_string())?;
    Ok(Some(InstallerFolder { folder: display(&root), installers }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        (dir, root)
    }

    fn touch(path: &Path) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"x").unwrap();
    }

    #[test]
    fn installer_names() {
        for yes in ["OllamaSetup.exe", "OllamaSetup (1).exe", "Ollama.dmg", "Ollama-darwin.zip", "ollama-linux-amd64.tgz", "ollama-linux-arm64.tar.zst", "ollama-windows-amd64.zip"] {
            assert!(is_ollama_installer(yes), "{yes}");
        }
        for no in ["ollama.exe", "Ollama App.exe", "OpenEdu_0.4.0_x64-setup.exe", "model.gguf", "ollama-notes.txt"] {
            assert!(!is_ollama_installer(no), "{no}");
        }
    }

    #[test]
    fn finds_installers_up_to_three_levels_down() {
        let (_d, root) = tmp();
        touch(&root.join("ollama").join("OllamaSetup.exe"));
        touch(&root.join("a/b/c/Ollama.dmg"));
        touch(&root.join("a/b/c/d/ollama-linux-amd64.tgz"));
        touch(&root.join("openedu").join("OpenEdu_0.4.0_x64-setup.exe"));
        let found = find_installers(&root);
        let names: Vec<&str> = found.iter().map(|i| i.name.as_str()).collect();
        assert_eq!(names, vec!["Ollama.dmg", "OllamaSetup.exe"]);
        assert_eq!(found[1].location, display(&root.join("ollama")));
        assert_eq!(found[1].bytes, 1);
    }

    #[cfg(windows)]
    #[test]
    fn does_not_follow_a_junction() {
        let (_d, base) = tmp();
        let root = base.join("stick");
        let outside = base.join("outside");
        fs::create_dir_all(&root).unwrap();
        touch(&outside.join("OllamaSetup.exe"));
        let out = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(root.join("link"))
            .arg(&outside)
            .output()
            .unwrap();
        assert!(out.status.success());
        assert!(find_installers(&root).is_empty());
    }

    #[test]
    fn installed_when_a_location_or_a_path_folder_has_it() {
        let (_d, root) = tmp();
        let bin = root.join("bin");
        let exe = exe_name();
        assert!(!installed_in(&[root.join("nope")], None, exe));
        touch(&bin.join(exe));
        let path = std::env::join_paths([root.join("empty"), bin.clone()]).unwrap();
        assert!(installed_in(&[], Some(&path), exe));
        assert!(installed_in(&[bin.join(exe)], None, exe));
        // A folder named like the program is not the program.
        let (_d2, other) = tmp();
        fs::create_dir_all(other.join(exe)).unwrap();
        let p2 = std::env::join_paths([other]).unwrap();
        assert!(!installed_in(&[], Some(&p2), exe));
    }

    #[test]
    fn this_machine_answers() {
        // Either answer is fine; the call must not panic on a real environment.
        let _ = ollama_installed();
    }
}
