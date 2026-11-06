//! Total physical memory, so the frontend can default to a local model that fits the machine.
//!
//! Why the Rust side at all: the WebView's `navigator.deviceMemory` is capped at 8 (and rounded), so
//! it cannot tell an 8 GB community-centre PC from a 16 GB laptop, which is exactly the line between
//! `gemma4:e2b` (4.6 GB) and `gemma4:e4b` (9.6 GB). The threshold itself lives in
//! `src/lib/models.ts`, where it is unit-tested; this module only reports bytes.
//!
//! Why not the `sysinfo` crate: it is not in the dependency tree, and even with default features off
//! its `system` feature drags in process and CPU enumeration this needs none of. One OS call per
//! platform adds no new crate to Cargo.lock: `windows-sys` 0.61 is already compiled in (tokio, mio)
//! and `libc` is already there for the Apple targets. Linux reads `/proc/meminfo` with std alone, so
//! its parser is testable on every host, including the Windows-only release build.

/// `None` when the OS call fails or the platform is not one we ship on. The frontend then keeps the
/// pre-RAM default rather than guessing.
#[tauri::command]
pub fn system_memory_bytes() -> Option<u64> {
    total_memory_bytes().filter(|&b| b > 0)
}

#[cfg(windows)]
fn total_memory_bytes() -> Option<u64> {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    // SAFETY: MEMORYSTATUSEX is plain data, so all-zero is a valid value; the API requires dwLength
    // to be set to the struct size before the call, and it writes only within that struct.
    let mut status: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    if unsafe { GlobalMemoryStatusEx(&mut status) } == 0 {
        return None;
    }
    Some(status.ullTotalPhys)
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn total_memory_bytes() -> Option<u64> {
    parse_meminfo_total(&std::fs::read_to_string("/proc/meminfo").ok()?)
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn total_memory_bytes() -> Option<u64> {
    let mut bytes: u64 = 0;
    let mut len = std::mem::size_of::<u64>();
    // SAFETY: hw.memsize is a u64; we pass a pointer to one with its exact size and no new value.
    let rc = unsafe {
        libc::sysctlbyname(
            c"hw.memsize".as_ptr(),
            &mut bytes as *mut u64 as *mut libc::c_void,
            &mut len,
            std::ptr::null_mut(),
            0,
        )
    };
    if rc != 0 {
        return None;
    }
    Some(bytes)
}

#[cfg(not(any(
    windows,
    target_os = "linux",
    target_os = "android",
    target_os = "macos",
    target_os = "ios"
)))]
fn total_memory_bytes() -> Option<u64> {
    None
}

/// `MemTotal:       16303468 kB` → bytes. The kernel's "kB" is KiB.
#[cfg_attr(not(any(target_os = "linux", target_os = "android")), allow(dead_code))]
fn parse_meminfo_total(meminfo: &str) -> Option<u64> {
    let line = meminfo.lines().find(|l| l.starts_with("MemTotal:"))?;
    let kib: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
    kib.checked_mul(1024)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_this_machine() {
        // Every host this is built on is a desktop with far more than 512 MiB; zero or a tiny value
        // would mean the struct or the units are wrong.
        assert!(system_memory_bytes().unwrap() > 512 * 1024 * 1024);
    }

    #[test]
    fn meminfo_total_is_kib() {
        let sample = "MemTotal:       16303468 kB\nMemFree:         1234567 kB\n";
        assert_eq!(parse_meminfo_total(sample), Some(16_303_468 * 1024));
    }

    #[test]
    fn meminfo_without_total_is_none() {
        assert_eq!(parse_meminfo_total("MemFree: 1 kB\n"), None);
        assert_eq!(parse_meminfo_total("MemTotal: lots kB\n"), None);
    }
}
