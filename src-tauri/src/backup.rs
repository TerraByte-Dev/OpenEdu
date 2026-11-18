//! The file of a learner-data backup (Settings › Learner data), so a copy cut short never carries a
//! backup's name.
//!
//! SQLite's `VACUUM INTO` makes the copy (through the sql plugin, from the webview). It writes straight to
//! the path it is given, does not flush it to disk, and a shutdown, a closed app or a power cut part way
//! leaves a cut-short file. Written to the picked name, that file looked like the newest good backup.
//!
//! So Rust opens the Save dialog itself, keeps the picked path, and gives the webview only
//! `<picked>.partial` to write to. `backup_finish` flushes that file to disk, checks it is a whole SQLite
//! database (its header's page size and page count match its length), and only then renames it to the
//! picked name. `backup_abandon` removes it after a copy that failed. The webview never names a path:
//! the only file these commands write, check, rename or remove is the one the user picked in the dialog,
//! plus `.partial`.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::State;
use tauri_plugin_dialog::DialogExt;

/// The backup in progress: the path the user picked, until it is finished or abandoned.
#[derive(Default)]
pub struct BackupState {
    picked: Mutex<Option<PathBuf>>,
}

impl BackupState {
    fn picked(&self) -> std::sync::MutexGuard<'_, Option<PathBuf>> {
        self.picked.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// Where `VACUUM INTO` writes before the copy is whole: the picked name plus `.partial`.
fn partial_of(picked: &Path) -> PathBuf {
    let mut s = picked.as_os_str().to_owned();
    s.push(".partial");
    PathBuf::from(s)
}

/// Ask where to save the backup. `Ok(Some(partial))` is the temporary file to copy into; `Ok(None)` when
/// the user cancelled. A `.partial` left there by an earlier backup that was cut short is removed first,
/// because SQLite will not write over a file.
#[tauri::command]
pub async fn backup_pick(app: tauri::AppHandle, state: State<'_, BackupState>, suggested_name: String) -> Result<Option<String>, String> {
    let name = sanitize_file_name(&suggested_name);
    // The blocking dialog must not run on the main thread (model_import.rs does the same).
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Back up all learner data")
            .set_file_name(name)
            .add_filter("Learner data backup", &["db"])
            .blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(picked) = picked else { return Ok(None) };
    let picked = picked.into_path().map_err(|e| e.to_string())?;
    let partial = start_in(&picked).map_err(|e| e.to_string())?;
    *state.picked() = Some(picked);
    Ok(Some(partial.to_string_lossy().into_owned()))
}

/// The copy is done: make it the backup. Returns the backup's path. On an error the `.partial` stays
/// for `backup_abandon` to remove, and nothing has the picked name that was not there before. Off the main
/// thread (`async`): flushing a large copy to a slow USB stick can take a while, and the window must not
/// freeze meanwhile.
#[tauri::command(async)]
pub fn backup_finish(state: State<'_, BackupState>) -> Result<String, String> {
    let mut guard = state.picked();
    let picked = guard.clone().ok_or_else(|| "No backup is being saved.".to_string())?;
    finish_in(&picked)?;
    *guard = None;
    Ok(picked.to_string_lossy().into_owned())
}

/// The copy failed: remove what it left under the temporary name. Off the main thread, as `backup_finish`.
#[tauri::command(async)]
pub fn backup_abandon(state: State<'_, BackupState>) -> Result<(), String> {
    if let Some(picked) = state.picked().take() {
        remove_if_there(&partial_of(&picked)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn remove_if_there(p: &Path) -> std::io::Result<()> {
    match fs::remove_file(p) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        r => r,
    }
}

/// Clear the way for a new copy of `picked`, and return the temporary path to copy into.
fn start_in(picked: &Path) -> std::io::Result<PathBuf> {
    let partial = partial_of(picked);
    remove_if_there(&partial)?;
    Ok(partial)
}

/// Flush the temporary copy to disk, check it is whole, then give it the picked name (replacing a file
/// there, which the Save dialog already asked about).
fn finish_in(picked: &Path) -> Result<(), String> {
    let partial = partial_of(picked);
    // Write access: Windows refuses FlushFileBuffers on a handle opened read-only.
    let mut f = fs::OpenOptions::new().read(true).write(true).open(&partial).map_err(|e| e.to_string())?;
    f.sync_all().map_err(|e| e.to_string())?;
    let len = f.metadata().map_err(|e| e.to_string())?.len();
    let mut header = [0u8; 100];
    let whole = f.read_exact(&mut header).is_ok() && is_whole(&header, len);
    drop(f);
    if !whole {
        return Err("The backup copy came out incomplete, so it was not kept. Try again.".into());
    }
    fs::rename(&partial, picked).map_err(|e| e.to_string())
}

/// A SQLite file is whole when its header is SQLite's and its length is its page count times its page
/// size. The page count in the header is trusted only when SQLite marks it current (offset 92 equals the
/// change counter at offset 24, as every SQLite since 3.7.0 writes it); otherwise the length must still be
/// whole pages.
fn is_whole(header: &[u8; 100], len: u64) -> bool {
    if &header[..16] != b"SQLite format 3\0" {
        return false;
    }
    let page_size = match u16::from_be_bytes([header[16], header[17]]) {
        1 => 65_536u64,
        n if n >= 512 && n.is_power_of_two() => n as u64,
        _ => return false,
    };
    let be32 = |at: usize| u32::from_be_bytes([header[at], header[at + 1], header[at + 2], header[at + 3]]) as u64;
    let pages = be32(28);
    if len == 0 || len % page_size != 0 {
        return false;
    }
    if be32(92) == be32(24) && pages > 0 {
        return len == pages * page_size;
    }
    true
}

/// The suggested name is only the dialog's default, but keep it a bare file name anyway.
fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() { '-' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() { "learner-data-backup.db".to_string() } else { trimmed.to_string() }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A header the way SQLite writes one: `pages` pages of `page_size`, page count marked current.
    fn header(page_size: u16, pages: u32) -> [u8; 100] {
        let mut h = [0u8; 100];
        h[..16].copy_from_slice(b"SQLite format 3\0");
        h[16..18].copy_from_slice(&page_size.to_be_bytes());
        h[24..28].copy_from_slice(&7u32.to_be_bytes());
        h[28..32].copy_from_slice(&pages.to_be_bytes());
        h[92..96].copy_from_slice(&7u32.to_be_bytes());
        h
    }

    fn db_file(path: &Path, page_size: u16, pages: u32, len: usize) {
        let mut bytes = vec![0u8; len];
        let h = header(page_size, pages);
        let n = h.len().min(len);
        bytes[..n].copy_from_slice(&h[..n]);
        fs::write(path, bytes).unwrap();
    }

    #[test]
    fn a_whole_copy_is_one_its_header_and_length_agree_on() {
        assert!(is_whole(&header(4096, 3), 3 * 4096));
        assert!(is_whole(&header(1, 2), 2 * 65_536));
        // Cut short: fewer pages on disk than the header says, or half a page.
        assert!(!is_whole(&header(4096, 3), 2 * 4096));
        assert!(!is_whole(&header(4096, 3), 3 * 4096 - 100));
        assert!(!is_whole(&header(4096, 3), 0));
        // Not SQLite, or a page size SQLite never writes.
        let mut other = header(4096, 3);
        other[0] = b'X';
        assert!(!is_whole(&other, 3 * 4096));
        assert!(!is_whole(&header(1000, 3), 3000));
        // A page count not marked current: whole pages are enough.
        let mut stale = header(4096, 9);
        stale[92..96].copy_from_slice(&6u32.to_be_bytes());
        assert!(is_whole(&stale, 3 * 4096));
        assert!(!is_whole(&stale, 3 * 4096 + 1));
    }

    #[test]
    fn a_finished_copy_takes_the_picked_name_and_the_temporary_name_goes() {
        let dir = tempfile::tempdir().unwrap();
        let picked = dir.path().join("openedu-backup-2026-11-18-2100.db");
        let partial = start_in(&picked).unwrap();
        assert_eq!(partial, dir.path().join("openedu-backup-2026-11-18-2100.db.partial"));
        db_file(&partial, 4096, 3, 3 * 4096);
        finish_in(&picked).unwrap();
        assert_eq!(fs::metadata(&picked).unwrap().len(), 3 * 4096);
        assert!(!partial.exists());
    }

    #[test]
    fn a_cut_short_copy_never_gets_the_picked_name() {
        let dir = tempfile::tempdir().unwrap();
        let picked = dir.path().join("backup.db");
        let partial = start_in(&picked).unwrap();
        db_file(&partial, 4096, 300, 40 * 4096);
        let err = finish_in(&picked).unwrap_err();
        assert!(err.contains("incomplete"), "{err}");
        assert!(!picked.exists());
        assert!(partial.exists());
    }

    #[test]
    fn a_cut_short_copy_never_replaces_the_backup_already_there() {
        let dir = tempfile::tempdir().unwrap();
        let picked = dir.path().join("backup.db");
        db_file(&picked, 4096, 2, 2 * 4096);
        let partial = start_in(&picked).unwrap();
        db_file(&partial, 4096, 300, 10);
        assert!(finish_in(&picked).is_err());
        assert_eq!(fs::metadata(&picked).unwrap().len(), 2 * 4096);
        // A whole copy does replace it: the Save dialog already asked.
        db_file(&partial, 4096, 5, 5 * 4096);
        finish_in(&picked).unwrap();
        assert_eq!(fs::metadata(&picked).unwrap().len(), 5 * 4096);
    }

    #[test]
    fn a_partial_left_by_an_earlier_cut_is_cleared_before_the_next_copy() {
        let dir = tempfile::tempdir().unwrap();
        let picked = dir.path().join("backup.db");
        fs::write(partial_of(&picked), b"cut short").unwrap();
        let partial = start_in(&picked).unwrap();
        assert!(!partial.exists());
    }

    #[test]
    fn no_copy_at_all_is_an_error_not_a_backup() {
        let dir = tempfile::tempdir().unwrap();
        let picked = dir.path().join("backup.db");
        assert!(finish_in(&picked).is_err());
        assert!(!picked.exists());
    }

    #[test]
    fn the_suggested_name_stays_a_bare_file_name() {
        assert_eq!(sanitize_file_name("..\\..\\x:y.db"), "-..-x-y.db");
        assert_eq!(sanitize_file_name("  "), "learner-data-backup.db");
    }
}
