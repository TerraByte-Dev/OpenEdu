//! Save a CSV the user asked for (the teacher overview export) to a place they pick.
//!
//! The app has no `fs` capability and the webview never names a path. This command opens the native
//! Save dialog itself, from Rust, and writes only to the file the user picked there, always with a
//! `.csv` extension, and never over a file the dialog did not warn about. So the webview can hand over text, but it cannot choose where it goes, overwrite
//! an arbitrary file, or write anything that is not a .csv. One file per call, one user click each.

use std::path::PathBuf;
use tauri_plugin_dialog::DialogExt;

/// `Ok(Some(path))` when written, `Ok(None)` when the user cancelled the dialog.
#[tauri::command]
pub async fn export_save_csv(
    app: tauri::AppHandle,
    suggested_name: String,
    contents: String,
) -> Result<Option<String>, String> {
    let name = with_csv_extension(PathBuf::from(sanitize_file_name(&suggested_name)));
    // The blocking dialog must not run on the main thread; an async command runs off it, and
    // spawn_blocking keeps the async runtime's worker free while the dialog is open.
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Save the teacher overview")
            .set_file_name(name.to_string_lossy())
            .add_filter("CSV spreadsheet", &["csv"])
            .blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;

    let Some(picked) = picked else { return Ok(None) };
    let path = csv_target(picked.into_path().map_err(|e| e.to_string())?)?;
    std::fs::write(&path, contents.as_bytes()).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Where to write the file the user picked. The dialog warns before replacing the file it shows, but
/// when the `.csv` had to be added the real target is a different file it never checked. So that
/// case refuses rather than silently overwrite `report.txt.csv`; the message tells the user why.
fn csv_target(picked: PathBuf) -> Result<PathBuf, String> {
    let target = with_csv_extension(picked.clone());
    if target != picked && target.exists() {
        let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        return Err(format!("{name} already exists. Save again and pick a different name, or pick that file itself to replace it."));
    }
    Ok(target)
}

/// Force a `.csv` extension: `report` and `report.exe` become `report.csv` and `report.exe.csv`.
fn with_csv_extension(path: PathBuf) -> PathBuf {
    let is_csv = path
        .extension()
        .map(|e| e.eq_ignore_ascii_case("csv"))
        .unwrap_or(false);
    if is_csv {
        return path;
    }
    let mut s = path.into_os_string();
    s.push(".csv");
    PathBuf::from(s)
}

/// The suggested name is only a default for the dialog, but keep it a bare file name anyway.
fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() { '-' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() { "openedu-overview".to_string() } else { trimmed.to_string() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_a_csv_extension() {
        assert_eq!(with_csv_extension(PathBuf::from("a/report.csv")), PathBuf::from("a/report.csv"));
        assert_eq!(with_csv_extension(PathBuf::from("a/report.CSV")), PathBuf::from("a/report.CSV"));
    }

    #[test]
    fn forces_a_csv_extension() {
        assert_eq!(with_csv_extension(PathBuf::from("a/report")), PathBuf::from("a/report.csv"));
        assert_eq!(with_csv_extension(PathBuf::from("a/report.exe")), PathBuf::from("a/report.exe.csv"));
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("openedu-export-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn refuses_to_overwrite_a_file_the_dialog_never_warned_about() {
        let dir = temp_dir("exists");
        std::fs::write(dir.join("report.txt.csv"), "keep me").unwrap();
        // The user typed report.txt; the dialog checked report.txt, not report.txt.csv.
        let err = csv_target(dir.join("report.txt")).unwrap_err();
        assert!(err.contains("report.txt.csv"), "{err}");
        assert_eq!(std::fs::read_to_string(dir.join("report.txt.csv")).unwrap(), "keep me");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn writes_when_the_added_extension_names_a_new_file() {
        let dir = temp_dir("new");
        assert_eq!(csv_target(dir.join("report.txt")).unwrap(), dir.join("report.txt.csv"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_picked_csv_may_be_replaced_because_the_dialog_already_asked() {
        let dir = temp_dir("csv");
        std::fs::write(dir.join("report.csv"), "old").unwrap();
        assert_eq!(csv_target(dir.join("report.csv")).unwrap(), dir.join("report.csv"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn suggested_name_is_a_bare_file_name() {
        assert_eq!(sanitize_file_name("../../etc/passwd"), "-..-etc-passwd");
        assert_eq!(sanitize_file_name("C:\\x\\y.csv"), "C--x-y.csv");
        assert_eq!(sanitize_file_name("  ..  "), "openedu-overview");
        assert_eq!(sanitize_file_name("Grade 5 overview"), "Grade 5 overview");
    }
}
