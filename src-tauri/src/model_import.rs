//! Offline model import (#275): put a model into the local Ollama from a folder or USB stick.
//!
//! A community centre with no internet cannot `ollama pull` a 1–10 GB model. With this, someone copies a
//! model onto a stick on a machine that has it (`scripts/export-model.mjs`, `docs/OFFLINE-KIT.md`) and
//! the learner's machine takes it in through Ollama's own API. The rules:
//!
//!   * Rust opens the folder picker. The webview never names a path: it gets back a plan of what the
//!     folder holds, and `model_import_start` accepts only file names from that plan.
//!   * Read-only, and only under the picked root. The root is canonicalised once; the scan never enters a
//!     symlink or junction; every file is re-checked against the root right before it is read.
//!   * Network goes to loopback Ollama only (`OLLAMA`), with system proxies ignored. Nothing here writes
//!     a file: Ollama stores the blobs itself (`POST /api/blobs/:digest`) and builds the model from them
//!     (`POST /api/create`). API shape: https://docs.ollama.com/api/create and
//!     https://github.com/ollama/ollama/blob/main/docs/api.md#push-a-blob
//!   * It never replaces a model: a name Ollama already has is refused before a byte is sent.
//!
//! Two layouts are understood. (a) A folder with a `Modelfile` whose `FROM` names a `.gguf` beside it.
//! (b) Ollama's own store layout, `manifests/…` + `blobs/sha256-…`, as copied out of `~/.ollama/models`.
//! Parsing the Modelfile and turning a manifest into a create request is pure TypeScript
//! (`src/lib/model-kit.ts`, unit-tested); this side only finds files, hashes them and moves bytes.

use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_http::reqwest;

/// The only host this module talks to.
pub(crate) const OLLAMA: &str = "http://127.0.0.1:11434";
const OLLAMA_ADDR: &str = "127.0.0.1:11434";
/// Modelfiles, manifests and text layers are small; anything bigger is not one.
const TEXT_CAP: u64 = 1024 * 1024;
/// Kept free after the import so the machine is not left with a full disk.
pub(crate) const HEADROOM: u64 = 1024 * 1024 * 1024;
const CHUNK: usize = 4 * 1024 * 1024;
/// Report progress at most this often (and at each file's end).
const TICK: Duration = Duration::from_millis(200);
/// Directory entries the scan looks at before it gives up. A kit is a handful of files.
const SCAN_CAP: usize = 20_000;

/// One import at a time. The root and the files under it that may be imported are fixed when the
/// picker returns.
#[derive(Default)]
pub struct ImportState {
    picked: Mutex<Option<Picked>>,
    cancel: Arc<AtomicBool>,
    busy: AtomicBool,
}

#[derive(Clone, Debug)]
pub(crate) struct Picked {
    pub root: PathBuf,
    /// Relative name (forward slashes) → the file. Only these can be imported.
    pub files: HashMap<String, Allowed>,
}

#[derive(Clone, Debug)]
pub(crate) struct Allowed {
    pub path: PathBuf,
    pub bytes: u64,
    /// The digest the file's own name promises (`blobs/sha256-<hex>`), checked after hashing.
    pub expect: Option<String>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub rel: String,
    pub bytes: u64,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Layer {
    pub media_type: String,
    pub digest: String,
    pub size: u64,
    /// Set for a weights layer (model / projector / adapter / draft) whose blob is in the folder.
    pub rel: Option<String>,
    /// Set for a small text layer (template, system, params, license, messages).
    pub text: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Candidate {
    #[serde(rename_all = "camelCase")]
    Gguf {
        /// Folder holding the Modelfile, relative to the root ("" for the root itself).
        dir: String,
        modelfile: String,
        ggufs: Vec<FileInfo>,
        /// A `checksums.sha256` / `SHA256SUMS` beside it, if there is one.
        checksums: Option<String>,
        /// Licence and terms files next to this model.
        licence_files: Vec<String>,
    },
    #[serde(rename_all = "camelCase")]
    Ollama {
        /// The name the model had where it was exported, e.g. `qwen3.5:0.8b`.
        name: String,
        config: Option<String>,
        layers: Vec<Layer>,
        /// Files in the kit's `licences/<model>` folder.
        licence_files: Vec<String>,
    },
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    /// For display only; nothing is ever sent back.
    pub root: String,
    pub candidates: Vec<Candidate>,
    /// Things that look wrong with the folder (a blob of the wrong size, an unreadable manifest).
    pub problems: Vec<String>,
    /// Free space where Ollama keeps models, when it could be measured.
    pub free_bytes: Option<u64>,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SpecFile {
    /// The file name Ollama is told (`model.gguf`); for a split GGUF, the shard's own name.
    pub label: String,
    /// A `rel` from the plan.
    pub rel: String,
    /// A digest from a checksums file, when the kit has one.
    pub expect: Option<String>,
    /// `draft_files` rather than `files` (a speculative-decoding draft model).
    #[serde(default)]
    pub draft: bool,
}

#[derive(Deserialize, Serialize, Debug, Clone)]
pub struct Message {
    pub role: String,
    pub content: String,
}

/// Exactly the `/api/create` fields this importer sends, so the webview cannot pass anything else on.
#[derive(Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateSpec {
    pub files: Vec<SpecFile>,
    pub template: Option<String>,
    pub system: Option<String>,
    pub renderer: Option<String>,
    pub parser: Option<String>,
    pub requires: Option<String>,
    pub parameters: Option<serde_json::Map<String, serde_json::Value>>,
    pub license: Option<Vec<String>>,
    pub messages: Option<Vec<Message>>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ImportEvent {
    /// `checking` → `verifying` → `copying` → `finishing`.
    #[serde(rename_all = "camelCase")]
    Phase { phase: &'static str, total: u64 },
    /// Bytes done within a phase, summed over every file (`total` is the same for both byte phases).
    #[serde(rename_all = "camelCase")]
    Bytes { phase: &'static str, done: u64, total: u64, file: String },
    /// A file with nothing to check its checksum against (a GGUF kit without a checksums file). It was
    /// read, but nobody can say it arrived undamaged, so the screen must not show a pass for it.
    #[serde(rename_all = "camelCase")]
    Unchecked { file: String },
    /// A file Ollama already had, so it was not sent again.
    #[serde(rename_all = "camelCase")]
    Skipped { file: String, bytes: u64 },
    /// Ollama's own words while it builds the model.
    #[serde(rename_all = "camelCase")]
    Status { text: String },
}

// ─── pure helpers ───────────────────────────────────────────────────────────────────────────────────

/// `sha256:<64 lowercase hex>` → the hex. Anything else is not a digest this module will use.
pub(crate) fn digest_hex(d: &str) -> Option<&str> {
    let hex = d.strip_prefix("sha256:")?;
    (hex.len() == 64 && hex.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))).then_some(hex)
}

/// A blob file name (`sha256-<hex>`) → its digest (`sha256:<hex>`).
pub(crate) fn digest_from_blob_name(name: &str) -> Option<String> {
    let d = format!("sha256:{}", name.strip_prefix("sha256-")?);
    digest_hex(&d).map(|_| d.clone())
}

/// Ollama model names: an optional namespace, a name and an optional tag. Kept narrower than Ollama's
/// own rule on purpose; a name with a host or odd characters is not something a learner types.
pub(crate) fn valid_model_name(name: &str) -> bool {
    fn part(s: &str, max: usize) -> bool {
        !s.is_empty()
            && s.len() <= max
            && s.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
            && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    }
    let (path, tag) = match name.split_once(':') {
        Some((p, t)) => (p, Some(t)),
        None => (name, None),
    };
    let segs: Vec<&str> = path.split('/').collect();
    segs.len() <= 2 && segs.iter().all(|s| part(s, 80)) && tag.map_or(true, |t| part(t, 80))
}

/// `None` when there is room (or the free space could not be measured, which is said elsewhere).
pub(crate) fn space_problem(need: u64, free: Option<u64>) -> Option<String> {
    let free = free?;
    let want = need.saturating_add(HEADROOM);
    (free < want).then(|| {
        format!(
            "There isn't enough free space. This model needs {} (plus 1 GB kept spare), and the disk Ollama \
             keeps models on has {} free. Free up some space, then try again.",
            gb(need),
            gb(free)
        )
    })
}

pub(crate) fn gb(n: u64) -> String {
    let g = n as f64 / 1e9;
    if g >= 1.0 { format!("{g:.1} GB") } else { format!("{} MB", (n as f64 / 1e6).round() as u64) }
}

/// Strip Windows' verbatim prefix for display. Never used to open anything.
pub(crate) fn display(p: &Path) -> String {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else {
        s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()
    }
}

fn rel_of(root: &Path, p: &Path) -> Option<String> {
    let rel = p.strip_prefix(root).ok()?;
    Some(rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>().join("/"))
}

/// Not a symlink or junction, and a directory.
fn real_dir(p: &Path) -> bool {
    fs::symlink_metadata(p).map(|m| m.is_dir() && !m.file_type().is_symlink()).unwrap_or(false)
}

fn real_file(p: &Path) -> Option<u64> {
    let m = fs::symlink_metadata(p).ok()?;
    (m.is_file() && !m.file_type().is_symlink()).then(|| m.len())
}

fn read_capped(p: &Path) -> Option<String> {
    let len = real_file(p)?;
    if len > TEXT_CAP {
        return None;
    }
    fs::read(p).ok().map(|b| String::from_utf8_lossy(&b).into_owned())
}

/// Entries of one directory, symlinks and junctions left out.
fn entries(dir: &Path) -> Vec<(PathBuf, fs::Metadata)> {
    let Ok(read) = fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<(PathBuf, fs::Metadata)> = read
        .flatten()
        .filter_map(|e| {
            let m = e.metadata().ok()?; // DirEntry::metadata does not follow links
            (!m.file_type().is_symlink()).then(|| (e.path(), m))
        })
        .take(SCAN_CAP)
        .collect();
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

/// Licence-looking files: LICENSE, LICENCE, NOTICE, COPYING, "Terms of Use", "Prohibited Use Policy".
pub(crate) fn is_licence_name(name: &str) -> bool {
    let n = name.to_lowercase();
    ["licen", "notice", "copying", "terms", "policy"].iter().any(|k| n.contains(k))
}

fn is_text_layer(media_type: &str) -> bool {
    ["template", "system", "params", "license", "messages"]
        .iter()
        .any(|t| media_type == format!("application/vnd.ollama.image.{t}"))
}

fn is_weights_layer(media_type: &str) -> bool {
    ["model", "projector", "adapter", "draft"]
        .iter()
        .any(|t| media_type == format!("application/vnd.ollama.image.{t}"))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Desc {
    media_type: String,
    digest: String,
    size: u64,
}

#[derive(Deserialize)]
struct Manifest {
    config: Option<Desc>,
    layers: Vec<Desc>,
}

/// `manifests/<host>/<namespace>/<model>/<tag>` → the name Ollama shows for it.
pub(crate) fn manifest_name(parts: &[String]) -> Option<String> {
    match parts {
        [host, ns, model, tag] if host == "registry.ollama.ai" && ns == "library" => Some(format!("{model}:{tag}")),
        [host, ns, model, tag] if host == "registry.ollama.ai" => Some(format!("{ns}/{model}:{tag}")),
        [host, ns, model, tag] => Some(format!("{host}/{ns}/{model}:{tag}")),
        _ => None,
    }
}

/// One Ollama store (`<dir>/manifests` + `<dir>/blobs`): every manifest under it, with its blobs.
fn scan_store(root: &Path, dir: &Path, files: &mut HashMap<String, Allowed>, problems: &mut Vec<String>) -> Vec<Candidate> {
    let blobs = dir.join("blobs");
    let mut out = Vec::new();
    // Breadth-first to the fixed depth of host/namespace/model/tag.
    let mut queue = VecDeque::from([(dir.join("manifests"), Vec::<String>::new())]);
    while let Some((d, parts)) = queue.pop_front() {
        for (path, meta) in entries(&d) {
            let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let mut next = parts.clone();
            next.push(name);
            if meta.is_dir() && next.len() < 4 {
                queue.push_back((path, next));
                continue;
            }
            if !meta.is_file() || next.len() != 4 {
                continue;
            }
            let Some(model_name) = manifest_name(&next) else { continue };
            let Some(text) = read_capped(&path) else {
                problems.push(format!("The model list for {model_name} could not be read."));
                continue;
            };
            let Ok(manifest) = serde_json::from_str::<Manifest>(&text) else {
                problems.push(format!("The model list for {model_name} is not valid."));
                continue;
            };
            let mut layers = Vec::new();
            // Registered as importable only if the whole model checks out.
            let mut mine = HashMap::new();
            let mut missing = false;
            for desc in &manifest.layers {
                let Some(hex) = digest_hex(&desc.digest) else {
                    problems.push(format!("{model_name} lists a file with a malformed checksum."));
                    missing = true;
                    continue;
                };
                let blob = blobs.join(format!("sha256-{hex}"));
                let wanted = is_weights_layer(&desc.media_type) || is_text_layer(&desc.media_type);
                if !wanted {
                    // Nested manifests (runner variants) and unknown layers are references; the import
                    // rebuilds the model from its weights and text, so it does not need them.
                    continue;
                }
                let on_disk = real_file(&blob);
                if on_disk != Some(desc.size) {
                    problems.push(match on_disk {
                        None => format!("{model_name} is missing a file (sha256-{}…).", &hex[..12]),
                        Some(n) => format!(
                            "A file of {model_name} (sha256-{}…) is {} instead of {}: it was not copied completely.",
                            &hex[..12],
                            gb(n),
                            gb(desc.size)
                        ),
                    });
                    missing = true;
                    continue;
                }
                let mut layer = Layer {
                    media_type: desc.media_type.clone(),
                    digest: desc.digest.clone(),
                    size: desc.size,
                    rel: None,
                    text: None,
                };
                if is_text_layer(&desc.media_type) {
                    // Template, parameters, licence: small, but they shape the model, so they are checked
                    // like the weights. A damaged or unreadable one drops the whole model, never just
                    // that file.
                    match read_verified(&blob, &desc.digest) {
                        Ok(t) => layer.text = Some(t),
                        Err(why) => {
                            problems.push(format!("A settings file of {model_name} (sha256-{}…) {why}.", &hex[..12]));
                            missing = true;
                            continue;
                        }
                    }
                } else if let Some(rel) = rel_of(root, &blob) {
                    // The blob's own name is the digest it must hash to (the manifest names the same one).
                    let expect = blob.file_name().and_then(|n| digest_from_blob_name(&n.to_string_lossy()));
                    mine.insert(rel.clone(), Allowed { path: blob.clone(), bytes: desc.size, expect });
                    layer.rel = Some(rel);
                }
                layers.push(layer);
            }
            let config = match &manifest.config {
                None => None,
                Some(c) => match digest_hex(&c.digest)
                    .ok_or("has a malformed checksum")
                    .and_then(|hex| read_verified(&blobs.join(format!("sha256-{hex}")), &c.digest))
                {
                    Ok(t) => Some(t),
                    Err(why) => {
                        problems.push(format!("The settings of {model_name} {why}."));
                        missing = true;
                        None
                    }
                },
            };
            if missing {
                continue;
            }
            let licence_files = licences_in(root, &[dir.join("licences").join(licence_dir_name(&model_name))], true);
            files.extend(mine);
            out.push(Candidate::Ollama { name: model_name, config, layers, licence_files });
        }
    }
    out
}

/// A folder with a Modelfile and the GGUF files beside it.
fn scan_gguf_dir(root: &Path, dir: &Path, files: &mut HashMap<String, Allowed>) -> Option<Candidate> {
    let list = entries(dir);
    let modelfile = list.iter().find(|(p, m)| {
        let n = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
        m.is_file() && (n == "modelfile" || n.ends_with(".modelfile"))
    })?;
    let text = read_capped(&modelfile.0)?;
    let mut ggufs = Vec::new();
    let mut checksums = None;
    for (p, m) in &list {
        if !m.is_file() {
            continue;
        }
        let n = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let lower = n.to_lowercase();
        if lower.ends_with(".gguf") {
            let rel = rel_of(root, p)?;
            files.insert(rel.clone(), Allowed { path: p.clone(), bytes: m.len(), expect: None });
            ggufs.push(FileInfo { rel, bytes: m.len() });
        } else if lower == "checksums.sha256" || lower == "sha256sums" || lower == "sha256sums.txt" {
            checksums = read_capped(p);
        }
    }
    // Licence files next to the model, or in the kit's `licences/<folder>` beside it.
    // The sibling `licences/<folder>` is looked up only below the picked root: never list a folder
    // outside what the user chose.
    let mut near = vec![dir.to_path_buf()];
    if dir != root {
        if let (Some(parent), Some(name)) = (dir.parent(), dir.file_name()) {
            near.push(parent.join("licences").join(name));
        }
    }
    let licence_files = licences_in(root, &near, false);
    Some(Candidate::Gguf { dir: rel_of(root, dir)?, modelfile: text, ggufs, checksums, licence_files })
}

/// Licence files in these folders (one level, no links), at most 20. In a `licences/<model>` folder
/// every file counts; elsewhere only names that look like a licence or terms.
fn licences_in(root: &Path, dirs: &[PathBuf], all: bool) -> Vec<String> {
    let mut out = Vec::new();
    for (i, d) in dirs.iter().enumerate() {
        if !real_dir(d) {
            continue;
        }
        let every = all || i > 0;
        for (p, m) in entries(d) {
            let n = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            if m.is_file() && (every || is_licence_name(&n)) && out.len() < 20 {
                if let Some(rel) = rel_of(root, &p) {
                    out.push(rel);
                }
            }
        }
    }
    out
}

/// The kit folder name the export script uses for a model's licences: `qwen3.5:0.8b` → `qwen3.5-0.8b`.
pub(crate) fn licence_dir_name(model_name: &str) -> String {
    let (path, tag) = model_name.rsplit_once(':').unwrap_or((model_name, "latest"));
    let model = path.rsplit('/').next().unwrap_or(path);
    let mut s = String::new();
    for c in format!("{model}-{tag}").to_lowercase().chars() {
        if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
            s.push(c);
        } else if !s.ends_with('-') {
            s.push('-');
        }
    }
    s.trim_matches('-').to_string()
}

pub(crate) fn sha256_bytes(bytes: &[u8]) -> String {
    let hex: String = Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect();
    format!("sha256:{hex}")
}

/// A small file read whole and checked against the digest its manifest gives it. The error finishes a
/// sentence ("… is damaged").
fn read_verified(p: &Path, digest: &str) -> Result<String, &'static str> {
    let len = real_file(p).ok_or("is missing")?;
    if len > TEXT_CAP {
        return Err("is too large to be a settings file");
    }
    let bytes = fs::read(p).map_err(|_| "can't be read")?;
    if sha256_bytes(&bytes) != digest {
        return Err("is damaged: its checksum doesn't match");
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Everything importable under `root` (already canonical). Looks at the root, `root/models`, and their
/// immediate subfolders; never enters a symlink or junction.
pub(crate) fn scan(root: &Path) -> (Vec<Candidate>, HashMap<String, Allowed>, Vec<String>) {
    let mut files = HashMap::new();
    let mut problems = Vec::new();
    let mut candidates = Vec::new();

    let mut bases = vec![root.to_path_buf()];
    let models = root.join("models");
    if real_dir(&models) {
        bases.push(models);
    }
    for base in &bases {
        if real_dir(&base.join("manifests")) && real_dir(&base.join("blobs")) {
            candidates.extend(scan_store(root, base, &mut files, &mut problems));
        }
    }
    let mut dirs = Vec::new();
    for base in &bases {
        dirs.push(base.clone());
        for (p, m) in entries(base) {
            let n = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
            if m.is_dir() && n != "blobs" && n != "manifests" && !dirs.contains(&p) {
                dirs.push(p);
            }
        }
    }
    for d in &dirs {
        if let Some(c) = scan_gguf_dir(root, d, &mut files) {
            candidates.push(c);
        }
    }
    (candidates, files, problems)
}

/// A planned file, re-checked right before it is read: still a plain file (not swapped for a link),
/// still under the root once canonicalised, still the size the plan showed.
pub(crate) fn recheck(root: &Path, a: &Allowed) -> Result<PathBuf, String> {
    let name = a.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let len = real_file(&a.path).ok_or_else(|| format!("{name} is no longer in the folder. Was the stick removed?"))?;
    let canon = fs::canonicalize(&a.path).map_err(|_| format!("{name} can't be opened."))?;
    if !canon.starts_with(root) {
        return Err(format!("{name} is outside the folder you picked, so it was not read."));
    }
    if len != a.bytes {
        return Err(format!("{name} changed size since the folder was picked. Pick the folder again."));
    }
    Ok(canon)
}

pub(crate) struct Job {
    pub label: String,
    pub draft: bool,
    pub allowed: Allowed,
    /// From a checksums file in the kit.
    pub expect: Option<String>,
}

/// Turn the webview's file list into jobs, accepting only names the scan itself listed.
pub(crate) fn resolve_jobs(picked: &Picked, spec: &[SpecFile]) -> Result<Vec<Job>, String> {
    if spec.is_empty() {
        return Err("There is no model file to import.".into());
    }
    let mut jobs = Vec::new();
    for f in spec {
        let label_ok = f.label.to_lowercase().ends_with(".gguf")
            && !f.label.contains(['/', '\\', ':'])
            && !f.label.starts_with('.');
        if !label_ok {
            return Err(format!("\"{}\" is not a usable model file name.", f.label));
        }
        let allowed = picked
            .files
            .get(&f.rel)
            .ok_or_else(|| format!("{} is not one of the files in the folder you picked.", f.rel))?;
        if let Some(e) = &f.expect {
            if digest_hex(e).is_none() {
                return Err(format!("The checksum listed for {} is malformed.", f.rel));
            }
        }
        jobs.push(Job { label: f.label.clone(), draft: f.draft, allowed: allowed.clone(), expect: f.expect.clone() });
    }
    Ok(jobs)
}

/// Streaming SHA-256. `on_bytes` gets the running count; `cancel` is checked between chunks.
pub(crate) fn sha256_file(path: &Path, cancel: &AtomicBool, mut on_bytes: impl FnMut(u64)) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| format!("can't open the file: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; CHUNK];
    let mut done = 0u64;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(CANCELLED.into());
        }
        let n = file.read(&mut buf).map_err(|e| format!("reading stopped part-way: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        done += n as u64;
        on_bytes(done);
    }
    let hex: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
    Ok(format!("sha256:{hex}"))
}

pub(crate) const CANCELLED: &str = "Import cancelled.";

// ─── where Ollama keeps models, and how much room is there ──────────────────────────────────────────

/// `OLLAMA_MODELS` when this process can see it, else Ollama's default for the platform. The free-space
/// check reads the nearest folder of this that exists, so a fresh install still gets checked.
pub(crate) fn ollama_store_dir() -> Option<PathBuf> {
    if let Some(v) = std::env::var_os("OLLAMA_MODELS").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(v));
    }
    #[cfg(target_os = "linux")]
    {
        // The Linux install script runs Ollama as its own user with this home.
        let service = PathBuf::from("/usr/share/ollama/.ollama/models");
        if service.exists() {
            return Some(service);
        }
    }
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })?;
    Some(PathBuf::from(home).join(".ollama").join("models"))
}

pub(crate) fn free_bytes_near(p: &Path) -> Option<u64> {
    let mut at = Some(p);
    while let Some(dir) = at {
        if dir.is_dir() {
            return free_bytes(dir);
        }
        at = dir.parent();
    }
    None
}

#[cfg(windows)]
fn free_bytes(dir: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let wide: Vec<u16> = dir.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut avail: u64 = 0;
    // SAFETY: `wide` is NUL-terminated and outlives the call; the out-pointer is a valid u64, and the
    // two other outputs are optional (null) per the API.
    let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut avail, std::ptr::null_mut(), std::ptr::null_mut()) };
    (ok != 0).then_some(avail)
}

#[cfg(unix)]
fn free_bytes(dir: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;
    let c = std::ffi::CString::new(dir.as_os_str().as_bytes()).ok()?;
    // SAFETY: statvfs is plain data; we pass a valid C string and a pointer to one zeroed struct.
    let mut st: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(c.as_ptr(), &mut st) } != 0 {
        return None;
    }
    Some((st.f_bavail as u64).saturating_mul(st.f_frsize as u64))
}

#[cfg(not(any(windows, unix)))]
fn free_bytes(_dir: &Path) -> Option<u64> {
    None
}

// ─── loopback HTTP ──────────────────────────────────────────────────────────────────────────────────

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        // A system proxy must never see a model upload, and loopback through a proxy fails anyway.
        .no_proxy()
        // A redirect could point anywhere; Ollama never sends one, so none is followed.
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| format!("can't start the connection to Ollama: {e}"))
}

const NOT_RUNNING: &str = "Ollama isn't answering on this computer. Start Ollama, then try again.";

/// True when Ollama already has a model by this name.
async fn model_exists(c: &reqwest::Client, name: &str) -> Result<bool, String> {
    let r = c
        .post(format!("{OLLAMA}/api/show"))
        .header("Content-Type", "application/json")
        .body(serde_json::json!({ "model": name }).to_string())
        .send()
        .await
        .map_err(|_| NOT_RUNNING.to_string())?;
    match r.status().as_u16() {
        200 => Ok(true),
        404 => Ok(false),
        s => Err(format!("Ollama gave an unexpected answer ({s}) when asked about {name}.")),
    }
}

async fn blob_exists(c: &reqwest::Client, digest: &str) -> Result<bool, String> {
    let r = c.head(format!("{OLLAMA}/api/blobs/{digest}")).send().await.map_err(|_| NOT_RUNNING.to_string())?;
    Ok(r.status().as_u16() == 200)
}

struct Reporter {
    ch: Channel<ImportEvent>,
    phase: &'static str,
    total: u64,
    base: u64,
    file: String,
    last: Instant,
}

impl Reporter {
    fn tick(&mut self, done_in_file: u64, force: bool) {
        if force || self.last.elapsed() >= TICK {
            self.last = Instant::now();
            let _ = self.ch.send(ImportEvent::Bytes {
                phase: self.phase,
                done: self.base + done_in_file,
                total: self.total,
                file: self.file.clone(),
            });
        }
    }
}

/// `HTTP/1.1 201 Created` → 201.
pub(crate) fn status_of(head: &str) -> Option<u16> {
    let line = head.lines().next()?;
    let mut parts = line.split_whitespace();
    parts.next().filter(|v| v.starts_with("HTTP/"))?;
    parts.next()?.parse().ok()
}

/// Stream one file to `POST /api/blobs/<digest>` over a plain loopback socket.
///
/// Not reqwest: the copy tauri-plugin-http ships is built without streaming request bodies, and turning
/// that feature on would change Cargo.lock for one call. The request is the simplest HTTP there is (one
/// POST, a Content-Length, `Connection: close`) to a server on this machine, and a plain socket makes
/// progress and cancellation a loop over chunks: a cancel stops sending and closes the socket. What
/// Ollama keeps of a half-sent blob is its business; that path is not tested here.
pub(crate) fn push_blob(addr: &str, path: &Path, digest: &str, bytes: u64, cancel: &AtomicBool, mut on_bytes: impl FnMut(u64)) -> Result<(), String> {
    use std::io::Write;
    use std::net::{TcpStream, ToSocketAddrs};
    let sock = addr.to_socket_addrs().ok().and_then(|mut a| a.next()).ok_or("bad Ollama address")?;
    if !sock.ip().is_loopback() {
        return Err("the importer only talks to Ollama on this computer".into());
    }
    let mut s = TcpStream::connect_timeout(&sock, Duration::from_secs(5)).map_err(|_| NOT_RUNNING.to_string())?;
    s.set_write_timeout(Some(Duration::from_secs(120))).ok();
    s.set_read_timeout(Some(Duration::from_secs(600))).ok();
    let mut file = fs::File::open(path).map_err(|e| format!("can't open the file: {e}"))?;
    let head = format!(
        "POST /api/blobs/{digest} HTTP/1.1\r\nHost: {addr}\r\nContent-Type: application/octet-stream\r\n\
         Content-Length: {bytes}\r\nConnection: close\r\n\r\n"
    );
    let lost = |e: std::io::Error| format!("the connection to Ollama dropped: {e}");
    s.write_all(head.as_bytes()).map_err(lost)?;
    let mut buf = vec![0u8; CHUNK];
    let mut sent = 0u64;
    while sent < bytes {
        if cancel.load(Ordering::Relaxed) {
            let _ = s.shutdown(std::net::Shutdown::Both);
            return Err(CANCELLED.into());
        }
        let n = file.read(&mut buf).map_err(|e| format!("reading stopped part-way: {e}"))?;
        if n == 0 {
            return Err("the file got shorter while it was being copied. Was the stick removed?".into());
        }
        let n = n.min((bytes - sent) as usize);
        s.write_all(&buf[..n]).map_err(lost)?;
        sent += n as u64;
        on_bytes(sent);
    }
    s.flush().map_err(lost)?;
    let mut resp = Vec::new();
    let _ = s.take(64 * 1024).read_to_end(&mut resp);
    let text = String::from_utf8_lossy(&resp);
    match status_of(&text) {
        Some(200 | 201) => Ok(()),
        Some(400) => Err("Ollama received a copy that doesn't match its checksum. The stick may be failing; copy the kit again.".into()),
        Some(code) => {
            let body = text.split_once("\r\n\r\n").map(|(_, b)| b.trim()).unwrap_or("");
            Err(format!("Ollama refused the file ({code}): {}", body.chars().take(200).collect::<String>()))
        }
        None => Err("Ollama closed the connection without an answer.".into()),
    }
}

pub(crate) fn create_body(model: &str, spec: &CreateSpec, files: &[(String, String, bool)]) -> serde_json::Value {
    let mut main = serde_json::Map::new();
    let mut draft = serde_json::Map::new();
    for (label, digest, is_draft) in files {
        if *is_draft { &mut draft } else { &mut main }.insert(label.clone(), digest.clone().into());
    }
    let mut body = serde_json::json!({ "model": model, "files": main, "stream": true });
    let o = body.as_object_mut().expect("object literal");
    if !draft.is_empty() {
        o.insert("draft_files".into(), draft.into());
    }
    let opt = |v: &Option<String>| v.as_ref().filter(|s| !s.is_empty()).map(|s| serde_json::Value::from(s.clone()));
    for (k, v) in [
        ("template", opt(&spec.template)),
        ("system", opt(&spec.system)),
        ("renderer", opt(&spec.renderer)),
        ("parser", opt(&spec.parser)),
        ("requires", opt(&spec.requires)),
    ] {
        if let Some(v) = v {
            o.insert(k.into(), v);
        }
    }
    if let Some(p) = spec.parameters.as_ref().filter(|p| !p.is_empty()) {
        o.insert("parameters".into(), p.clone().into());
    }
    if let Some(l) = spec.license.as_ref().filter(|l| !l.is_empty()) {
        o.insert("license".into(), serde_json::json!(l));
    }
    if let Some(m) = spec.messages.as_ref().filter(|m| !m.is_empty()) {
        o.insert("messages".into(), serde_json::json!(m));
    }
    body
}

/// One NDJSON line of `/api/create`'s stream → (status, error).
pub(crate) fn create_line(line: &str) -> (Option<String>, Option<String>) {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { return (None, None) };
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).map(str::to_string);
    (s("status"), s("error"))
}

async fn create_model(c: &reqwest::Client, body: &serde_json::Value, ch: &Channel<ImportEvent>) -> Result<(), String> {
    let mut r = c
        .post(format!("{OLLAMA}/api/create"))
        .header("Content-Type", "application/json")
        .body(body.to_string())
        .send()
        .await
        .map_err(|_| NOT_RUNNING.to_string())?;
    if !r.status().is_success() {
        let s = r.status().as_u16();
        let text = r.text().await.unwrap_or_default();
        let msg = create_line(&text).1.unwrap_or(text);
        return Err(format!("Ollama could not build the model ({s}): {}", msg.chars().take(300).collect::<String>()));
    }
    let mut buf = Vec::new();
    let mut ok = false;
    while let Some(chunk) = r.chunk().await.map_err(|e| format!("The connection to Ollama dropped: {e}"))? {
        buf.extend_from_slice(&chunk);
        while let Some(i) = buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = buf.drain(..=i).collect();
            let (status, error) = create_line(String::from_utf8_lossy(&line).trim());
            if let Some(e) = error {
                return Err(format!("Ollama could not build the model: {e}"));
            }
            if let Some(s) = status {
                ok |= s == "success";
                let _ = ch.send(ImportEvent::Status { text: s });
            }
        }
    }
    let (status, error) = create_line(String::from_utf8_lossy(&buf).trim());
    if let Some(e) = error {
        return Err(format!("Ollama could not build the model: {e}"));
    }
    ok |= status.as_deref() == Some("success");
    if ok { Ok(()) } else { Err("Ollama stopped before it said the model was ready.".into()) }
}

async fn run_import(
    model: &str,
    spec: &CreateSpec,
    picked: &Picked,
    cancel: Arc<AtomicBool>,
    ch: &Channel<ImportEvent>,
) -> Result<(), String> {
    if !valid_model_name(model) {
        return Err("That name can't be used. Use letters, numbers, dots, dashes, and one colon before a tag (like my-model:small).".into());
    }
    let jobs = resolve_jobs(picked, &spec.files)?;
    let total: u64 = jobs.iter().map(|j| j.allowed.bytes).sum();
    let _ = ch.send(ImportEvent::Phase { phase: "checking", total });

    let c = client()?;
    if model_exists(&c, model).await? {
        return Err(format!("Ollama already has a model called {model}. Pick another name; nothing was replaced."));
    }
    if let Some(p) = space_problem(total, ollama_store_dir().as_deref().and_then(free_bytes_near)) {
        return Err(p);
    }

    // Verify every file before sending any, so a bad stick fails in minutes, not after gigabytes.
    let _ = ch.send(ImportEvent::Phase { phase: "verifying", total });
    let mut digests = Vec::new();
    let mut base = 0u64;
    for job in &jobs {
        let path = recheck(&picked.root, &job.allowed)?;
        let name = job.label.clone();
        let mut rep = Reporter { ch: ch.clone(), phase: "verifying", total, base, file: name.clone(), last: Instant::now() };
        let flag = cancel.clone();
        let len = job.allowed.bytes;
        let digest = tauri::async_runtime::spawn_blocking(move || {
            let d = sha256_file(&path, &flag, |n| rep.tick(n, false));
            if d.is_ok() {
                rep.tick(len, true);
            }
            d
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| if e == CANCELLED { e } else { format!("{name}: {e}") })?;
        if job.allowed.expect.is_none() && job.expect.is_none() {
            let _ = ch.send(ImportEvent::Unchecked { file: name.clone() });
        }
        for want in [&job.allowed.expect, &job.expect].into_iter().flatten() {
            if *want != digest {
                return Err(format!(
                    "{name} is damaged: its checksum doesn't match the one it was saved with. Copy the kit again from the machine that made it."
                ));
            }
        }
        base += job.allowed.bytes;
        digests.push(digest);
    }

    let _ = ch.send(ImportEvent::Phase { phase: "copying", total });
    let mut base = 0u64;
    for (job, digest) in jobs.iter().zip(&digests) {
        if cancel.load(Ordering::Relaxed) {
            return Err(CANCELLED.into());
        }
        let name = job.label.clone();
        if blob_exists(&c, digest).await? {
            let _ = ch.send(ImportEvent::Skipped { file: name.clone(), bytes: job.allowed.bytes });
        } else {
            let path = recheck(&picked.root, &job.allowed)?;
            let mut rep = Reporter { ch: ch.clone(), phase: "copying", total, base, file: name.clone(), last: Instant::now() };
            let (flag, d, len) = (cancel.clone(), digest.clone(), job.allowed.bytes);
            tauri::async_runtime::spawn_blocking(move || push_blob(OLLAMA_ADDR, &path, &d, len, &flag, |n| rep.tick(n, false)))
                .await
                .map_err(|e| e.to_string())?
                .map_err(|e| if e == CANCELLED { e } else { format!("{name}: {e}") })?;
        }
        base += job.allowed.bytes;
        let _ = ch.send(ImportEvent::Bytes { phase: "copying", done: base, total, file: name });
    }

    // Last chance to stop: past this point Ollama is building the model and nothing is safe to cancel.
    if cancel.load(Ordering::Relaxed) {
        return Err(CANCELLED.into());
    }
    let _ = ch.send(ImportEvent::Phase { phase: "finishing", total });
    let files: Vec<(String, String, bool)> =
        jobs.iter().zip(digests).map(|(j, d)| (j.label.clone(), d, j.draft)).collect();
    create_model(&c, &create_body(model, spec, &files), ch).await
}

// ─── commands ───────────────────────────────────────────────────────────────────────────────────────

pub(crate) async fn pick_folder(app: &AppHandle, title: &'static str) -> Result<Option<PathBuf>, String> {
    let app = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || app.dialog().file().set_title(title).blocking_pick_folder())
        .await
        .map_err(|e| e.to_string())?;
    picked.map(|fp| fp.into_path().map_err(|_| "That folder can't be opened.".to_string())).transpose()
}

/// Open the folder picker and report what the folder holds. `None` when the user cancelled.
#[tauri::command]
pub async fn model_import_pick(app: AppHandle, state: State<'_, ImportState>) -> Result<Option<Plan>, String> {
    if state.busy.load(Ordering::SeqCst) {
        return Err("An import is already running.".into());
    }
    let Some(raw) = pick_folder(&app, "Choose the folder or USB stick with the model").await? else {
        return Ok(None);
    };
    let root = fs::canonicalize(&raw).map_err(|_| "That folder can't be opened.".to_string())?;
    if !root.is_dir() {
        return Err("That is not a folder.".into());
    }
    let scan_root = root.clone();
    let (candidates, files, problems) =
        tauri::async_runtime::spawn_blocking(move || scan(&scan_root)).await.map_err(|e| e.to_string())?;
    let free = ollama_store_dir().as_deref().and_then(free_bytes_near);
    *state.picked.lock().map_err(|_| "import state poisoned".to_string())? = Some(Picked { root: root.clone(), files });
    Ok(Some(Plan { root: display(&root), candidates, problems, free_bytes: free }))
}

/// Import from the last picked folder. Progress arrives on `on_event`; resolves when Ollama says the
/// model is ready.
#[tauri::command]
pub async fn model_import_start(
    model: String,
    spec: CreateSpec,
    on_event: Channel<ImportEvent>,
    state: State<'_, ImportState>,
) -> Result<String, String> {
    if state.busy.swap(true, Ordering::SeqCst) {
        return Err("An import is already running.".into());
    }
    state.cancel.store(false, Ordering::SeqCst);
    let picked = state.picked.lock().map(|p| p.clone()).unwrap_or(None);
    let result = match picked {
        None => Err("Pick the folder with the model first.".to_string()),
        Some(p) => run_import(model.trim(), &spec, &p, state.cancel.clone(), &on_event).await,
    };
    state.busy.store(false, Ordering::SeqCst);
    result.map(|_| model.trim().to_string())
}

/// Stop a running import at the next chunk. Has no effect once Ollama is building the model.
#[tauri::command]
pub fn model_import_cancel(state: State<'_, ImportState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

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

    fn sha(bytes: &[u8]) -> String {
        let hex: String = Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect();
        format!("sha256:{hex}")
    }

    /// An Ollama store with one model: weights + licence + params, laid out as the export script does.
    fn store(base: &Path, weights: &[u8]) -> String {
        let blob = |bytes: &[u8]| {
            let d = sha(bytes);
            touch(&base.join("blobs").join(d.replace(':', "-")), bytes);
            d
        };
        let w = blob(weights);
        let lic = blob(b"Apache-2.0 text");
        let params = blob(br#"{"temperature":1}"#);
        let cfg = blob(br#"{"renderer":"qwen3.5","parser":"qwen3.5"}"#);
        let manifest = serde_json::json!({
            "schemaVersion": 2,
            "config": { "mediaType": "application/vnd.docker.container.image.v1+json", "digest": cfg, "size": 42 },
            "layers": [
                { "mediaType": "application/vnd.ollama.image.model", "digest": w, "size": weights.len() },
                { "mediaType": "application/vnd.ollama.image.license", "digest": lic, "size": 15 },
                { "mediaType": "application/vnd.ollama.image.params", "digest": params, "size": 17 },
                { "mediaType": "application/vnd.ollama.manifest.list.v2+json", "digest": format!("sha256:{}", "0".repeat(64)), "size": 9 }
            ]
        });
        touch(
            &base.join("manifests/registry.ollama.ai/library/tiny/0.1b"),
            manifest.to_string().as_bytes(),
        );
        w
    }

    #[test]
    fn digest_shapes() {
        let hex = "a".repeat(64);
        assert_eq!(digest_hex(&format!("sha256:{hex}")), Some(hex.as_str()));
        assert_eq!(digest_hex(&format!("sha256:{}", "A".repeat(64))), None);
        assert_eq!(digest_hex(&format!("sha256:{}", "a".repeat(63))), None);
        assert_eq!(digest_hex(&format!("sha256:{}/../x", "a".repeat(58))), None);
        assert_eq!(digest_from_blob_name(&format!("sha256-{hex}")), Some(format!("sha256:{hex}")));
        assert_eq!(digest_from_blob_name("model.gguf"), None);
    }

    #[test]
    fn model_names() {
        for ok in ["kit-test-qwen0.8b", "qwen3.5:0.8b", "me/tutor:v1", "a"] {
            assert!(valid_model_name(ok), "{ok}");
        }
        for bad in ["", ":tag", "-x", "a b", "host/ns/model", "x:", "x:y:z", "../x", "x/", "ünï"] {
            assert!(!valid_model_name(bad), "{bad}");
        }
    }

    #[test]
    fn space_check_keeps_a_gigabyte_spare() {
        let need = 1_000_000_000;
        assert_eq!(space_problem(need, None), None, "unmeasurable space does not block");
        assert_eq!(space_problem(need, Some(need + HEADROOM)), None);
        let msg = space_problem(need, Some(need + HEADROOM - 1)).unwrap();
        assert!(msg.contains("1.0 GB") && msg.contains("2.1 GB"), "{msg}");
        assert!(space_problem(u64::MAX, Some(u64::MAX - 1)).is_some(), "no overflow");
    }

    #[test]
    fn free_space_is_measured_for_a_folder_that_does_not_exist_yet() {
        let (_d, root) = tmp();
        assert!(free_bytes_near(&root.join("not/yet/made")).unwrap() > 0);
    }

    #[test]
    fn sha256_streams_across_chunks_and_reports_bytes() {
        let (_d, root) = tmp();
        let data: Vec<u8> = (0..(CHUNK * 2 + 123)).map(|i| (i % 251) as u8).collect();
        let f = root.join("big.gguf");
        touch(&f, &data);
        let mut seen = Vec::new();
        let d = sha256_file(&f, &AtomicBool::new(false), |n| seen.push(n)).unwrap();
        assert_eq!(d, sha(&data));
        assert_eq!(seen, vec![CHUNK as u64, 2 * CHUNK as u64, data.len() as u64]);
    }

    #[test]
    fn sha256_stops_when_cancelled() {
        let (_d, root) = tmp();
        let f = root.join("a.gguf");
        touch(&f, b"abc");
        assert_eq!(sha256_file(&f, &AtomicBool::new(true), |_| {}), Err(CANCELLED.to_string()));
    }

    #[test]
    fn scans_an_ollama_store_under_models() {
        let (_d, root) = tmp();
        let w = store(&root.join("models"), b"GGUF weights");
        touch(&root.join("models/licences/tiny-0.1b/LICENSE.txt"), b"x");
        touch(&root.join("models/licences/tiny-0.1b/Gemma Prohibited Use Policy.pdf"), b"x");
        touch(&root.join("models/licences/other-model/LICENSE.txt"), b"x");
        let (cands, files, problems) = scan(&root);
        assert!(problems.is_empty(), "{problems:?}");
        assert_eq!(cands.len(), 1);
        let Candidate::Ollama { name, config, layers, licence_files } = &cands[0] else { panic!("not ollama") };
        assert_eq!(name, "tiny:0.1b");
        // Only this model's licence folder, every file in it.
        assert_eq!(
            licence_files,
            &vec![
                "models/licences/tiny-0.1b/Gemma Prohibited Use Policy.pdf".to_string(),
                "models/licences/tiny-0.1b/LICENSE.txt".to_string()
            ]
        );
        assert!(config.as_deref().unwrap().contains("renderer"));
        // The nested manifest layer is a reference and is left out.
        assert_eq!(layers.len(), 3);
        let rel = format!("models/blobs/{}", w.replace(':', "-"));
        assert_eq!(layers[0].rel.as_deref(), Some(rel.as_str()));
        assert_eq!(layers[1].text.as_deref(), Some("Apache-2.0 text"));
        assert_eq!(files.len(), 1, "only weights are importable files");
        assert_eq!(files[&rel].expect.as_deref(), Some(w.as_str()));
    }

    #[test]
    fn a_short_blob_is_a_problem_not_a_candidate() {
        let (_d, root) = tmp();
        let w = store(&root, b"GGUF weights");
        touch(&root.join("blobs").join(w.replace(':', "-")), b"GGUF");
        let (cands, files, problems) = scan(&root);
        assert!(cands.is_empty());
        assert!(files.is_empty());
        assert!(problems[0].contains("not copied completely"), "{problems:?}");
    }

    /// Overwrite the blob for `content` with bytes of the same length, so only its checksum is wrong.
    fn corrupt(base: &Path, content: &[u8]) {
        let mut bad = content.to_vec();
        bad[0] ^= 1;
        touch(&base.join("blobs").join(sha(content).replace(':', "-")), &bad);
    }

    #[test]
    fn a_damaged_settings_file_drops_the_model_and_says_so() {
        let (_d, root) = tmp();
        store(&root, b"GGUF weights");
        corrupt(&root, br#"{"temperature":1}"#);
        let (cands, files, problems) = scan(&root);
        assert!(cands.is_empty(), "{cands:?}");
        assert!(files.is_empty(), "a dropped model leaves nothing importable");
        assert_eq!(problems.len(), 1, "{problems:?}");
        assert!(problems[0].contains("tiny:0.1b") && problems[0].contains("is damaged"), "{problems:?}");
    }

    #[test]
    fn a_damaged_config_drops_the_model_and_says_so() {
        let (_d, root) = tmp();
        store(&root, b"GGUF weights");
        corrupt(&root, br#"{"renderer":"qwen3.5","parser":"qwen3.5"}"#);
        let (cands, _, problems) = scan(&root);
        assert!(cands.is_empty());
        assert!(problems[0].starts_with("The settings of tiny:0.1b is damaged"), "{problems:?}");
    }

    #[test]
    fn an_oversized_settings_file_drops_the_model_and_says_so() {
        let (_d, root) = tmp();
        let big = vec![b'x'; TEXT_CAP as usize + 1];
        let d = sha(&big);
        touch(&root.join("blobs").join(d.replace(':', "-")), &big);
        let w = sha(b"GGUF");
        touch(&root.join("blobs").join(w.replace(':', "-")), b"GGUF");
        let manifest = serde_json::json!({ "layers": [
            { "mediaType": "application/vnd.ollama.image.model", "digest": w, "size": 4 },
            { "mediaType": "application/vnd.ollama.image.template", "digest": d, "size": big.len() }
        ]});
        touch(&root.join("manifests/registry.ollama.ai/library/big/1"), manifest.to_string().as_bytes());
        let (cands, _, problems) = scan(&root);
        assert!(cands.is_empty());
        assert!(problems[0].contains("too large to be a settings file"), "{problems:?}");
    }

    #[test]
    fn licence_folder_names_match_the_export_script() {
        assert_eq!(licence_dir_name("qwen3.5:0.8b"), "qwen3.5-0.8b");
        assert_eq!(licence_dir_name("me/Tutor:V1"), "tutor-v1");
        assert_eq!(licence_dir_name("hf.co/org/m:q4 k"), "m-q4-k");
    }

    #[test]
    fn scans_a_gguf_folder_with_modelfile_checksums_and_licences() {
        let (_d, root) = tmp();
        let dir = root.join("models").join("tiny");
        touch(&dir.join("Modelfile"), b"FROM ./model.gguf\n");
        touch(&dir.join("model.gguf"), b"GGUF");
        touch(&dir.join("checksums.sha256"), b"abc  model.gguf\n");
        touch(&dir.join("Gemma Terms of Use.txt"), b"terms");
        touch(&dir.join("readme.txt"), b"x");
        touch(&root.join("models/licences/tiny/Prohibited Use Policy.txt"), b"x");
        // Licences of other models, or loose at the top, are not this model's.
        touch(&root.join("LICENSE.txt"), b"x");
        touch(&root.join("models/licences/other/LICENSE.txt"), b"x");
        let (cands, files, _) = scan(&root);
        let Candidate::Gguf { dir, modelfile, ggufs, checksums, licence_files } = &cands[0] else { panic!("not gguf") };
        assert_eq!(
            licence_files,
            &vec!["models/tiny/Gemma Terms of Use.txt".to_string(), "models/licences/tiny/Prohibited Use Policy.txt".to_string()]
        );
        assert_eq!(dir, "models/tiny");
        assert_eq!(modelfile, "FROM ./model.gguf\n");
        assert_eq!(ggufs, &vec![FileInfo { rel: "models/tiny/model.gguf".into(), bytes: 4 }]);
        assert!(checksums.is_some());
        assert!(files.contains_key("models/tiny/model.gguf"));
    }

    #[test]
    fn only_files_the_scan_listed_can_be_imported() {
        let (_d, root) = tmp();
        touch(&root.join("Modelfile"), b"FROM model.gguf");
        touch(&root.join("model.gguf"), b"GGUF");
        touch(&root.join("other.bin"), b"x");
        let (_, files, _) = scan(&root);
        let picked = Picked { root: root.clone(), files };
        let f = |label: &str, rel: &str| SpecFile { label: label.into(), rel: rel.into(), expect: None, draft: false };
        assert!(resolve_jobs(&picked, &[f("model.gguf", "model.gguf")]).is_ok());
        for (label, rel) in [
            ("model.gguf", "other.bin"),
            ("model.gguf", "../model.gguf"),
            ("model.gguf", s(&root.join("model.gguf"))),
            ("../x.gguf", "model.gguf"),
            ("model.bin", "model.gguf"),
            ("a/b.gguf", "model.gguf"),
        ] {
            assert!(resolve_jobs(&picked, &[f(label, rel)]).is_err(), "{label} {rel}");
        }
        assert!(resolve_jobs(&picked, &[]).is_err());
        let bad = SpecFile { expect: Some("md5:x".into()), ..f("model.gguf", "model.gguf") };
        assert!(resolve_jobs(&picked, &[bad]).is_err());
    }

    fn s(p: &Path) -> &str {
        p.to_str().unwrap()
    }

    #[test]
    fn recheck_catches_a_file_that_changed_after_the_pick() {
        let (_d, root) = tmp();
        let p = root.join("model.gguf");
        touch(&p, b"GGUF");
        let a = Allowed { path: p.clone(), bytes: 4, expect: None };
        assert_eq!(recheck(&root, &a).unwrap(), p);
        touch(&p, b"GGUF!");
        assert!(recheck(&root, &a).unwrap_err().contains("changed size"));
        fs::remove_file(&p).unwrap();
        assert!(recheck(&root, &a).unwrap_err().contains("no longer"));
    }

    #[test]
    fn recheck_refuses_a_file_outside_the_root() {
        let (_d, base) = tmp();
        let root = base.join("root");
        fs::create_dir(&root).unwrap();
        let outside = base.join("secret.gguf");
        touch(&outside, b"GGUF");
        let a = Allowed { path: outside, bytes: 4, expect: None };
        assert!(recheck(&root, &a).unwrap_err().contains("outside"));
    }

    #[cfg(windows)]
    fn junction(link: &Path, target: &Path) {
        let out = std::process::Command::new("cmd").args(["/c", "mklink", "/J"]).arg(link).arg(target).output().unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stdout));
    }

    #[cfg(unix)]
    fn junction(link: &Path, target: &Path) {
        std::os::unix::fs::symlink(target, link).unwrap();
    }

    // A junction needs no admin rights on Windows, so a kit could carry one; the scan must not walk it.
    #[test]
    fn a_junction_or_symlink_out_of_the_root_is_not_scanned() {
        let (_d, base) = tmp();
        let root = base.join("kit");
        let outside = base.join("outside");
        fs::create_dir_all(&root).unwrap();
        store(&outside, b"GGUF weights");
        touch(&outside.join("tiny").join("Modelfile"), b"FROM model.gguf");
        touch(&outside.join("tiny").join("model.gguf"), b"GGUF");
        touch(&outside.join("LICENSE"), b"x");
        junction(&root.join("models"), &outside);
        junction(&root.join("tiny"), &outside.join("tiny"));
        let (cands, files, _) = scan(&root);
        assert!(cands.is_empty(), "{cands:?}");
        assert!(files.is_empty());
    }

    #[test]
    fn a_file_reached_through_a_junction_is_refused_at_read_time() {
        let (_d, base) = tmp();
        let root = base.join("kit");
        let outside = base.join("outside");
        fs::create_dir_all(&root).unwrap();
        touch(&outside.join("model.gguf"), b"GGUF");
        junction(&root.join("in"), &outside);
        let a = Allowed { path: root.join("in").join("model.gguf"), bytes: 4, expect: None };
        assert!(recheck(&root, &a).unwrap_err().contains("outside"));
    }

    #[test]
    fn manifest_names() {
        let p = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(manifest_name(&p(&["registry.ollama.ai", "library", "qwen3.5", "0.8b"])).unwrap(), "qwen3.5:0.8b");
        assert_eq!(manifest_name(&p(&["registry.ollama.ai", "me", "tutor", "v1"])).unwrap(), "me/tutor:v1");
        assert_eq!(manifest_name(&p(&["hf.co", "org", "m", "q4"])).unwrap(), "hf.co/org/m:q4");
        assert_eq!(manifest_name(&p(&["a", "b"])), None);
    }

    #[test]
    fn create_body_carries_only_what_was_given() {
        let spec = CreateSpec {
            renderer: Some("qwen3.5".into()),
            template: Some(String::new()),
            license: Some(vec!["Apache".into()]),
            parameters: Some(serde_json::from_str(r#"{"temperature":1}"#).unwrap()),
            ..Default::default()
        };
        let body = create_body(
            "kit-test",
            &spec,
            &[("model.gguf".into(), "sha256:aa".into(), false), ("draft.gguf".into(), "sha256:bb".into(), true)],
        );
        assert_eq!(
            body,
            serde_json::json!({
                "model": "kit-test", "stream": true,
                "files": { "model.gguf": "sha256:aa" },
                "draft_files": { "draft.gguf": "sha256:bb" },
                "renderer": "qwen3.5",
                "license": ["Apache"],
                "parameters": { "temperature": 1 }
            })
        );
    }

    /// A one-shot server on loopback that records the request and answers with `reply`.
    fn mock(reply: &'static str) -> (String, std::thread::JoinHandle<Vec<u8>>) {
        use std::io::Write;
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = l.local_addr().unwrap().to_string();
        let h = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut got = Vec::new();
            let mut buf = [0u8; 65536];
            // Read the head, then exactly Content-Length bytes of body (or until the client hangs up).
            loop {
                match s.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => got.extend_from_slice(&buf[..n]),
                }
                if let Some(split) = got.windows(4).position(|w| w == b"\r\n\r\n") {
                    let head = String::from_utf8_lossy(&got[..split]).into_owned();
                    let len: usize = head
                        .lines()
                        .find_map(|l| l.strip_prefix("Content-Length: "))
                        .and_then(|v| v.trim().parse().ok())
                        .unwrap_or(0);
                    if got.len() - (split + 4) >= len {
                        break;
                    }
                }
            }
            let _ = s.write_all(reply.as_bytes());
            got
        });
        (addr, h)
    }

    #[test]
    fn push_blob_streams_the_whole_file_with_the_digest_in_the_path() {
        let (_d, root) = tmp();
        let data: Vec<u8> = (0..(CHUNK + 777)).map(|i| (i % 253) as u8).collect();
        let f = root.join("model.gguf");
        touch(&f, &data);
        let digest = sha(&data);
        let (addr, h) = mock("HTTP/1.1 201 Created\r\nContent-Length: 0\r\n\r\n");
        let mut seen = Vec::new();
        push_blob(&addr, &f, &digest, data.len() as u64, &AtomicBool::new(false), |n| seen.push(n)).unwrap();
        let got = h.join().unwrap();
        let split = got.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
        let head = String::from_utf8_lossy(&got[..split]);
        assert!(head.starts_with(&format!("POST /api/blobs/{digest} HTTP/1.1\r\n")), "{head}");
        assert!(head.contains(&format!("Content-Length: {}", data.len())));
        assert_eq!(&got[split + 4..], &data[..]);
        assert_eq!(seen.last(), Some(&(data.len() as u64)));
    }

    #[test]
    fn push_blob_turns_a_400_into_a_damaged_copy_message() {
        let (_d, root) = tmp();
        let f = root.join("model.gguf");
        touch(&f, b"GGUF");
        let (addr, h) = mock("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n");
        let err = push_blob(&addr, &f, &sha(b"other"), 4, &AtomicBool::new(false), |_| {}).unwrap_err();
        h.join().unwrap();
        assert!(err.contains("doesn't match its checksum"), "{err}");
    }

    #[test]
    fn push_blob_stops_when_cancelled_and_refuses_a_remote_host() {
        let (_d, root) = tmp();
        let f = root.join("model.gguf");
        touch(&f, b"GGUF");
        let (addr, h) = mock("HTTP/1.1 201 Created\r\n\r\n");
        assert_eq!(push_blob(&addr, &f, &sha(b"GGUF"), 4, &AtomicBool::new(true), |_| {}), Err(CANCELLED.to_string()));
        h.join().unwrap();
        let err = push_blob("192.0.2.1:11434", &f, &sha(b"GGUF"), 4, &AtomicBool::new(false), |_| {}).unwrap_err();
        assert!(err.contains("only talks to Ollama on this computer"), "{err}");
    }

    #[test]
    fn status_lines() {
        assert_eq!(status_of("HTTP/1.1 201 Created\r\n"), Some(201));
        assert_eq!(status_of("HTTP/1.0 400 Bad Request"), Some(400));
        assert_eq!(status_of(""), None);
        assert_eq!(status_of("garbage 200"), None);
    }

    #[test]
    fn create_stream_lines() {
        assert_eq!(create_line(r#"{"status":"success"}"#), (Some("success".into()), None));
        assert_eq!(create_line(r#"{"error":"bad gguf"}"#), (None, Some("bad gguf".into())));
        assert_eq!(create_line("not json"), (None, None));
    }

    #[test]
    fn display_strips_the_verbatim_prefix() {
        assert_eq!(display(Path::new(r"\\?\E:\kit")), r"E:\kit");
        assert_eq!(display(Path::new(r"\\?\UNC\server\share")), r"\\server\share");
        assert_eq!(display(Path::new("/media/kit")), "/media/kit");
    }

    #[test]
    fn licence_names() {
        for n in ["LICENSE", "licence.txt", "Gemma Terms of Use.txt", "Prohibited Use Policy.pdf", "NOTICE", "COPYING"] {
            assert!(is_licence_name(n), "{n}");
        }
        assert!(!is_licence_name("model.gguf"));
    }
}
