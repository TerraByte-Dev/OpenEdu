# The offline kit

A USB stick (or any folder) that sets up OpenEdu on a computer with no internet: the app, Ollama, and a
model, with the model's licence. You make it on a computer that already has the model; the computer
that receives it needs nothing but the stick.

Nothing in this repo ships a model or an installer. The kit is assembled by whoever hands it out, and
they take on the model's licence terms when they redistribute it (see [Licences](#licences)).

## What goes on the stick

```
OpenEdu-Kit/
├── openedu/                      OpenEdu's installer, e.g. OpenEdu_0.4.0_x64-setup.exe
├── ollama/                       Ollama's installer from https://ollama.com/download
│                                 (Windows: OllamaSetup.exe · Mac: Ollama.dmg · Linux: ollama-linux-amd64.tgz)
└── models/
    ├── manifests/registry.ollama.ai/library/qwen3.5/0.8b      ┐ "ollama" layout: Ollama's own files,
    ├── blobs/sha256-…                                          ┘ copied byte for byte
    ├── qwen3.5-0.8b/              or the "gguf" layout:
    │   ├── model.gguf               the weights
    │   ├── Modelfile                FROM ./model.gguf, plus template, parameters, licence
    │   └── checksums.sha256         sha256sum format, checked on import
    └── licences/qwen3.5-0.8b/     the model's licence as Ollama recorded it,
        └── LICENSE.txt            plus anything else its terms require (see below)
```

The `ollama` and `openedu` folders are what the setup screen means by "the installer on your kit". A
kit can hold more than one model; the import screen lets the person pick.

## Making a kit

On a computer where `ollama list` shows the model:

```bash
node scripts/export-model.mjs <model> <kit-folder> [--layout ollama|gguf] [--models-dir <dir>]

node scripts/export-model.mjs qwen3.5:0.8b E:\OpenEdu-Kit          # Windows, stick on E:
node scripts/export-model.mjs gemma4:e2b /Volumes/KIT               # Mac
```

- **Read-only on the source.** It opens Ollama's store for reading only and does not need Ollama
  running. Before it creates anything, it resolves both folders through any junction or symlink and
  refuses a kit whose `models` folder would be (or be inside) the store, and a kit that contains the
  store. Model names may only use letters, digits, `.`, `_` and `-` in each part. It finds the store
  from `--models-dir`, then `OLLAMA_MODELS`, then the Linux service home, then `~/.ollama/models`.
- **Verified as it copies.** Each file is hashed while it is written and kept only if the hash matches
  the digest Ollama recorded, so a kit that finishes is one that will import. Re-running skips files
  already copied intact, which resumes an interrupted copy.
- **`--layout ollama` (default)** copies the manifest and every blob it has. It works for every model,
  including ones with a vision projector or a draft model (gemma4).
- **`--layout gguf`** writes `model.gguf`, a `Modelfile` built from the model's template, parameters,
  licence, renderer and parser, and `checksums.sha256`. It is the open format other tools read too, and
  only fits single-file models; the script says so and stops for the rest. Values are written in
  triple quotes, literally (a stop token with a newline survives); a value that starts or ends with a
  quote mark can't be written that way, so the script stops and asks for `--layout ollama`.
- It also writes the model's licence text to `models/licences/<model>/` and creates the empty `ollama/`
  and `openedu/` folders.

Then copy the two installers in by hand: Ollama's from ollama.com/download, OpenEdu's from the GitHub
release. Both are the publishers' own signed files; don't repackage them.

A kit made by hand works too: any folder with a `Modelfile` whose `FROM` names a `.gguf` next to it.
`FROM` must be a file in that folder (not a path elsewhere, not a model name to download). `ADAPTER` is
not supported yet. Add a `checksums.sha256` (`sha256sum model.gguf > checksums.sha256`): without one the
model still imports, but the screen says it couldn't tell whether the copy was damaged, and a
checksums file that doesn't list the model file is refused.

## Using a kit

1. Plug in the stick. Run `openedu/`'s installer and open OpenEdu.
2. If Ollama is missing, the setup screen says so and offers **Find the Ollama installer**. Pick the
   stick; the app shows where `OllamaSetup.exe` is. Double-click it there, then press **Check again**.
   OpenEdu never runs an installer itself, and it shows the folder as text rather than opening a file
   window (that would need a shell permission the app doesn't have).
3. When Ollama runs but has no model, the setup screen (or **Settings › Models › Import a model from a
   USB stick or folder**) offers the import. Choose the stick or its `models` folder.
4. The screen shows the model, its size, the free space, and the licence files next to that model,
   and suggests a name. Press **Import**. It checks there's room (the model's size plus 1 GB kept
   spare), checks each model file's SHA-256 against the blob's own name or `checksums.sha256`, copies
   the files into Ollama, and has Ollama build the model. It can be cancelled until that last step.
   In Ollama's layout the small settings files (template, parameters, licence) and the model's config
   are checked against the manifest when the folder is picked; a damaged one drops that model with a
   message. A GGUF kit without `checksums.sha256` imports with a warning, and the check step shows
   "Not checked" instead of a pass.
5. The model becomes the tutor model, and the setup check runs again.

An import never replaces a model: a name Ollama already has is refused before anything is sent. If the
computer already has the model under its own name, the screen offers to use that one instead.

## How the import works

`src-tauri/src/model_import.rs` (commands `model_import_pick`, `model_import_start`,
`model_import_cancel`). Rust opens the folder picker; the webview never names a path, and an import
may only name files the scan listed. The scan never enters a symlink or junction, and each file is
re-checked against the picked folder right before it is read.

It speaks only to `http://127.0.0.1:11434`, with system proxies ignored, using Ollama's API
([docs.ollama.com/api/create](https://docs.ollama.com/api/create),
[blobs](https://github.com/ollama/ollama/blob/main/docs/api.md#push-a-blob)):

1. `POST /api/show` to make sure the name is free.
2. `HEAD /api/blobs/sha256:<digest>` per file; a file Ollama already has is not sent again.
3. `POST /api/blobs/sha256:<digest>` streams the file; Ollama checks the digest again on its side.
4. `POST /api/create` with `files` (and `draft_files`), plus `template`, `system`, `parameters`,
   `license`, `messages`, `renderer`, `parser` and `requires` when the export has them.

OpenEdu writes no file. Ollama stores the blobs and builds the model. Redirects are not followed, so
nothing leaves the loopback address. What Ollama keeps of a blob whose upload was cancelled is up to
Ollama; that case is not tested here.

The decisions (Modelfile parsing, the create request, names, progress) are in `src/lib/model-kit.ts`;
the setup guide's states and wording are in `src/lib/ollama-guide.ts`. Both are pure and unit-tested.

## Licences

Redistributing a model is redistributing someone else's work under their terms. Read the model's
licence before you hand a kit to anyone.

- **Gemma 4** (`gemma4:*`): Apache 2.0 since its release on 2026-04-02. The licence text Ollama keeps
  is enough; the script copies it.
- **Gemma 1-3** (`gemma3:*`, `gemma3n:*`, `gemma2:*`): the Gemma Terms of Use require that anyone you give the model to
  receives the Terms and the use restrictions. Put both in `models/licences/<model>/`:
  [Gemma Terms of Use](https://ai.google.dev/gemma/terms) and
  [Gemma Prohibited Use Policy](https://ai.google.dev/gemma/prohibited_use_policy). The export script
  and the import screen remind you for these models.
- **Qwen 3.5** (`qwen3.5:*`): Apache 2.0. The licence text Ollama keeps is enough; the script copies it.
- **Anything else**: check its model card. Some licences need a NOTICE file, an attribution line or
  an acceptable-use policy that Ollama's copy does not include.

The import screen lists the licence and terms files next to the model (in its own folder, or in the
kit's `models/licences/<model>/`), and warns when there are none. For a Gemma model it also says whether
the Terms of Use and the Prohibited Use Policy are there. Neither blocks the import.
