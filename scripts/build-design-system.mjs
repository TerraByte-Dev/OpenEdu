// Build the OpenEdu design system into self-contained HTML cards for Claude Design.
//
// WHAT THIS IS FOR: Claude Design ingests these cards and then generates new work using our colors,
// typography, and components. They are not documentation — they are generation exemplars. Whatever CSS
// a card contains is what Claude learns OpenEdu looks like, so a card that invents its own button
// teaches a button that exists nowhere in the app.
//
// THE CENTRAL TRICK — we do not parse CSS for values. Every card inlines the whole of src/index.css
// verbatim and lets the browser resolve it. The derived tokens (--rule, --ink-dim, --phosphor-faint …)
// are `rgb(var(--phosphor-rgb) / a)` and resolve lazily at use time, so verbatim CSS gets all 11 themes
// correct for free. We parse only for NAMES: which properties exist, which theme ids exist. The payoff
// is structural — a parse bug produces a wrong text label beside a correct swatch, never a wrong design.
//
// THE ENABLING REWRITE — `html[data-theme="x"]` becomes `[data-theme="x"]`, so a plain
// `<div data-theme="amber">` scopes a theme inside one page. That is what makes an 11-theme contact
// sheet possible at all.
//
//   GOTCHA, and the #1 way a card silently looks wrong: setting data-theme on a descendant changes the
//   VARIABLES, not properties already resolved on an ancestor. `body { background: var(--bg) }` resolved
//   at :root and does not re-resolve. Every themed tile must restate `background: var(--bg);
//   color: var(--ink)` on ITSELF.
//
// READ-ONLY over the app. This script reads src/index.css, src/lib/theme.ts and src/assets/**. It writes
// only design/dist/. Do not make it edit app files — the whole design system is meant to be additive.
//
// Cards are authored in design/authored/*.html (committed) and generated here; both land in design/dist/
// (gitignored, regenerated in milliseconds). Run with `npm run design`.

import { readFile, writeFile, readdir, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSS_SRC = path.join(ROOT, "src/index.css");
const THEME_SRC = path.join(ROOT, "src/lib/theme.ts");
const AUTHORED = path.join(ROOT, "design/authored");
const OUT = path.join(ROOT, "design/dist");

// Bundled assets, by the short name a card asks for. Values are paths relative to src/, matching the
// url() strings in index.css.
const ASSETS = {
  Lexend: "assets/fonts/Lexend-latin.woff2",
  "IBMPlexMono-400": "assets/fonts/IBMPlexMono-400-latin.woff2",
  "IBMPlexMono-500": "assets/fonts/IBMPlexMono-500-latin.woff2",
  ShareTechMono: "assets/fonts/ShareTechMono-latin.woff2",
  Inter: "assets/fonts/Inter-latin.woff2",
  VT323: "assets/fonts/VT323-latin.woff2",
  globe: "assets/brand/terrabyte-globe.png",
};

// Every face the app renders in normal UI. This is the DEFAULT on purpose: an author who never thinks
// about fonts gets a correct card that is ~40 KiB heavier than strictly needed. The failure mode of
// forgetting is "slightly fat", never "wrong typeface".
//
// Inter is deliberately absent — it sits behind Lexend in both stacks it appears in, so it never
// renders, while being the largest file (62.8 KiB base64). It is carried only by the typography card,
// as a specimen of a face the system declares but does not use.
const CORE = ["Lexend", "IBMPlexMono-400", "IBMPlexMono-500", "ShareTechMono"];
const ALL = [...CORE, "Inter", "VT323"];

// DesignSync.get_file caps reads at 256 KiB. A card above that can never be read back out of the
// project to diff or verify, so we keep headroom and fail loudly rather than discover it after a push.
const MAX_CARD_BYTES = 240 * 1024;

const MIME = { ".woff2": "font/woff2", ".png": "image/png" };

// ── parsing ────────────────────────────────────────────────────────────────────────────────────────

/** Body of the {...} block whose opening brace is at openIdx. Depth-scanned, not indexOf("}"), so a
 *  nested at-rule inside a theme block would survive. */
function blockAt(css, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(openIdx + 1, i);
  }
  throw new Error(`build-design-system: unbalanced braces from index ${openIdx} in src/index.css`);
}

/** Custom-property declarations inside a block body. */
function decls(body) {
  const out = {};
  for (const [, k, v] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[k] = v.trim();
  return out;
}

function parseCss(css) {
  const rootIdx = css.search(/^:root\s*\{/m);
  if (rootIdx < 0) throw new Error("build-design-system: no `:root {` block in src/index.css");
  const root = decls(blockAt(css, css.indexOf("{", rootIdx)));
  const count = Object.keys(root).length;
  if (count < 20) {
    throw new Error(`build-design-system: only ${count} custom properties in :root — expected 20+. Did the token block move?`);
  }

  // The `\s*\{` is load-bearing: it rejects the COMPOUND selector near index.css:272
  // (`html[data-theme="dark"] .phosphor-glow, …`), which would otherwise parse as a bogus theme block
  // containing nothing but a text-shadow reset.
  const themes = {};
  for (const m of css.matchAll(/^html\[data-theme="([\w-]+)"\]\s*\{/gm)) {
    themes[m[1]] = decls(blockAt(css, css.indexOf("{", m.index)));
  }
  return { root, themes };
}

function parseThemes(ts) {
  const start = ts.indexOf("THEMES: Theme[] = [");
  if (start < 0) throw new Error("build-design-system: could not find `THEMES: Theme[] = [` in src/lib/theme.ts");
  const body = ts.slice(start, ts.indexOf("];", start));
  const out = [];
  const re = /id:\s*"([^"]+)"[\s\S]*?name:\s*"([^"]+)"[\s\S]*?blurb:\s*"([^"]+)"[\s\S]*?family:\s*"([^"]+)"/g;
  for (const [, id, name, blurb, family] of body.matchAll(re)) out.push({ id, name, blurb, family });
  if (out.length === 0) {
    throw new Error("build-design-system: parsed 0 themes from src/lib/theme.ts — the regex expects id/name/blurb/family in that order on each entry.");
  }
  return out;
}

// ── shell ──────────────────────────────────────────────────────────────────────────────────────────

/** Drop @font-face blocks whose src points at a file this card is not carrying, so the browser never
 *  attempts a fetch on a path we stripped. */
function dropUnusedFontFaces(css, keepPaths) {
  let out = "";
  let cursor = 0;
  for (const m of [...css.matchAll(/@font-face\s*\{/g)]) {
    const open = css.indexOf("{", m.index);
    const body = blockAt(css, open);
    const end = open + body.length + 2;
    const url = body.match(/url\(['"]?\.\/([^'")]+)['"]?\)/);
    const keep = !url || keepPaths.has(url[1]);
    out += css.slice(cursor, m.index) + (keep ? css.slice(m.index, end) : "");
    cursor = end;
  }
  return out + css.slice(cursor);
}

async function inlineAssets(css, names) {
  const keep = new Set(names.map((n) => {
    if (!ASSETS[n]) throw new Error(`build-design-system: unknown asset "${n}" — known: ${Object.keys(ASSETS).join(", ")}`);
    return ASSETS[n];
  }));

  let out = dropUnusedFontFaces(css, keep);

  for (const rel of keep) {
    const buf = await readFile(path.join(ROOT, "src", rel));
    const uri = `data:${MIME[path.extname(rel)]};base64,${buf.toString("base64")}`;
    out = out.replaceAll(`./${rel}`, uri);
  }

  // Any local url() still standing belongs to an asset this card deliberately does not carry — e.g.
  // .tb-logo's globe mask on a card that has no logo in it. Drop the whole declaration so the browser
  // never issues the fetch. The rule survives minus that property, which is correct: a card that does
  // not carry the globe does not use .tb-logo either.
  out = out.replace(/[-\w]+\s*:\s*[^;{}]*url\(['"]?\.\/[^)]*\)[^;{}]*;/g, "");

  const leftover = out.match(/url\(['"]?\.\/[^'")]+['"]?\)/);
  if (leftover) {
    throw new Error(`build-design-system: ${leftover[0]} survived inlining and could not be stripped — a card would fetch it at render time. Add it to ASSETS.`);
  }
  return out;
}

/** Re-declare the derived tokens on every [data-theme] element.
 *
 *  Without this, descendant-scoped theming is silently WRONG. `--rule: rgb(var(--phosphor-rgb) / 0.18)`
 *  is declared on :root, so its var() resolves against :root's channel value and the result is inherited
 *  as an already-computed colour. A tile that overrides --phosphor-rgb changes --phosphor but NOT --rule,
 *  --ink-dim, --phosphor-faint … so an amber tile draws cyan borders and cyan captions.
 *
 *  The app never hits this because data-theme lives on <html>, the same element as :root — declaration
 *  and override coincide. Re-emitting the derived tokens on [data-theme] restores that coincidence.
 *
 *  Inserted immediately after :root so the per-theme blocks still win: [data-theme] and
 *  [data-theme="dark"] have equal specificity (0,1,0), so source order decides, and dark/light must keep
 *  their opaque --rule overrides. Derived from :root at build time, so a new derived token is picked up
 *  automatically. */
function rescopeDerivedTokens(css, root) {
  const derived = Object.entries(root).filter(([, v]) => v.includes("var("));
  if (!derived.length) return css;

  const block = `\n/* preview-only: see rescopeDerivedTokens() in scripts/build-design-system.mjs */\n[data-theme]{\n${
    derived.map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}\n`;

  const rootIdx = css.search(/^:root\s*\{/m);
  const open = css.indexOf("{", rootIdx);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(0, i + 1) + block + css.slice(i + 1);
  }
  return css;
}

async function buildShell(css, names, root) {
  let out = css.replace(/@import\s+["']tailwindcss["'];?/, "");     // 1 — would hit the network
  out = out.replaceAll("html[data-theme=", "[data-theme=");          // 2 — the enabling rewrite
  out = out.replaceAll("html.crt-off", ".crt-off");                  // 3 — same, for the CRT kill switch
  out = rescopeDerivedTokens(out, root);                             // 3b — makes (2) actually correct
  out = await inlineAssets(out, names);                              // 4
  return out + PREVIEW_RESET;                                        // 5 — @theme{} (6) is left alone: inert
}

// The app pins the viewport (body{overflow:hidden;height:100vh}); a preview page must scroll. Also the
// shared card furniture, so every card gets the same frame without restating it.
const PREVIEW_RESET = `
/* ── preview-only, appended by scripts/build-design-system.mjs ── */
html,body{height:auto;overflow:auto;background:var(--bg);color:var(--ink);font-family:var(--font-body)}
body{padding:32px;line-height:1.5}
.ds h1{font-family:var(--font-display);font-size:1.5rem;color:var(--phosphor);margin:0 0 4px;letter-spacing:.02em}
.ds .ds-lede{color:var(--ink-dim);font-size:.875rem;margin:0 0 24px;max-width:62ch}
.ds h2{font-family:var(--font-mono);font-size:.6875rem;text-transform:uppercase;letter-spacing:.18em;
  color:var(--ink-faint);margin:32px 0 12px;font-weight:600}
.ds .ds-row{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-bottom:12px}
.ds .ds-grid{display:grid;gap:12px}
.ds .ds-code{font-family:var(--font-mono);font-size:.75rem;color:var(--ink-dim);background:var(--lcd);
  border:1px solid var(--rule);border-radius:8px;padding:10px 12px;overflow-x:auto;margin:8px 0 0}
.ds .ds-note{color:var(--ink-faint);font-size:.75rem;margin:6px 0 0}
`;

/** Wrap a card body. The @dsCard comment MUST be output line 1 — Claude Design reads the group from it. */
function page(group, title, body) {
  return `<!-- @dsCard group="${group}" -->
<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${title}</title>
<style>__SHELL__</style>
</head><body class="ds">
${body}
</body></html>
`;
}

// ── cards ──────────────────────────────────────────────────────────────────────────────────────────

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// A role is what a generator can act on; a bare hex is noise. Anything not listed still renders, under
// its own name — this table only adds meaning where we have some to add.
const ROLES = {
  "--bg": "page background",
  "--panel": "raised surface — sidebars, header bars",
  "--panel-lite": "card surface, hover rows",
  "--lcd": "recessed surface — code blocks, readouts",
  "--rule": "every border",
  "--phosphor": "primary accent, glows, active state",
  "--phosphor-bright": "hover text, highlights",
  "--phosphor-dim": "deep accent shade",
  "--phosphor-ink": "accent-tinted body text",
  "--phosphor-faint": "accent glow / rim",
  "--phosphor-veil": "accent wash behind active rows",
  "--ink": "body text",
  "--ink-em": "emphasis — the brightest text",
  "--ink-dim": "secondary text",
  "--ink-faint": "captions, labels, metadata",
};

function swatch(name, value, role) {
  const isColor = !/^(rgb|#)/.test(value) ? false : true;
  return `<div class="sw">
  <div class="sw-chip" style="background:var(${name})"></div>
  <div class="sw-meta">
    <code>${name}</code>
    ${role ? `<span class="sw-role">${esc(role)}</span>` : ""}
    <span class="sw-val">${esc(value)}</span>
  </div>
</div>`;
}

function paletteCard(root) {
  const colorTokens = Object.entries(root).filter(([, v]) => /^(#|rgb)/.test(v));
  const other = Object.entries(root).filter(([, v]) => !/^(#|rgb)/.test(v));

  return page("Foundations/Color", "Phosphor Palette", `
<style>
.sw{display:flex;gap:12px;align-items:center;padding:8px;border:1px solid var(--rule);border-radius:8px;background:var(--panel)}
.sw-chip{width:44px;height:44px;border-radius:4px;border:1px solid var(--rule);flex-shrink:0}
.sw-meta{display:flex;flex-direction:column;gap:2px;min-width:0}
.sw-meta code{font-family:var(--font-mono);font-size:.75rem;color:var(--phosphor-ink)}
.sw-role{font-size:.6875rem;color:var(--ink-dim)}
.sw-val{font-family:var(--font-mono);font-size:.625rem;color:var(--ink-faint)}
.pal{grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
.alpha{display:flex;gap:0;border:1px solid var(--rule);border-radius:8px;overflow:hidden}
.alpha div{flex:1;height:56px;display:flex;align-items:flex-end;justify-content:center;padding-bottom:4px;
  font-family:var(--font-mono);font-size:.5625rem;color:var(--ink-faint)}
</style>
<h1>Phosphor Palette</h1>
<p class="ds-lede">Every colour in OpenEdu derives from two channel tokens — <code>--phosphor-rgb</code> and
<code>--ink-rgb</code>. Derived tokens resolve them lazily at use time, which is why recolouring a theme
only swaps eight base values and the other seventeen cascade for free. Use the token, never the hex.</p>

<h2>Colour tokens</h2>
<div class="ds-grid pal">
${colorTokens.map(([k, v]) => swatch(k, v, ROLES[k])).join("\n")}
</div>

<h2>Alpha ladder</h2>
<p class="ds-note">The opacities that actually ship, over <code>--phosphor-rgb</code>. Use one of these
rather than inventing a new one.</p>
<div class="alpha">
${[0.03, 0.045, 0.08, 0.14, 0.18, 0.2, 0.24, 0.28, 0.35]
  .map((a) => `<div style="background:rgb(var(--phosphor-rgb) / ${a})">${a}</div>`).join("\n")}
</div>

<h2>Non-colour tokens</h2>
<div class="ds-grid" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">
${other.map(([k, v]) => `<div class="sw"><div class="sw-meta"><code>${k}</code><span class="sw-val">${esc(v)}</span></div></div>`).join("\n")}
</div>
`);
}

function themeMatrixCard(themes, cssThemes) {
  const tile = (t) => {
    // data-theme on the tile itself, and the tile restates bg/ink — see the gotcha in the header.
    const attr = t.id === "openedu" ? "" : ` data-theme="${t.id}"`;
    return `<div class="tile"${attr} style="background:var(--bg);color:var(--ink)">
  <div class="tile-head">
    <span class="tile-name">${esc(t.name)}</span>
    <span class="tile-fam ${t.family}">${t.family}</span>
  </div>
  <div class="tile-blurb">${esc(t.blurb)}</div>
  <div class="tile-chips">
    ${["--bg", "--panel", "--phosphor", "--ink"].map((v) => `<span style="background:var(${v})" title="${v}"></span>`).join("")}
  </div>
  <div class="tile-demo">
    <button class="btn btn-primary">Continue</button>
    <span class="tag">Level 3</span>
  </div>
  <code class="tile-id">${t.id}</code>
</div>`;
  };

  return page("Foundations/Color", "Theme Matrix", `
<style>
.mx{grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
.tile{border:1px solid var(--rule);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:8px}
.tile-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.tile-name{font-family:var(--font-display);font-size:.9375rem;color:var(--phosphor)}
.tile-fam{font-family:var(--font-mono);font-size:.5625rem;text-transform:uppercase;letter-spacing:.1em;
  padding:2px 6px;border-radius:9999px;border:1px solid var(--rule);color:var(--ink-faint)}
.tile-fam.crt{color:var(--phosphor-ink);border-color:var(--phosphor-faint)}
.tile-blurb{font-size:.75rem;color:var(--ink-dim);min-height:2.4em;line-height:1.4}
.tile-chips{display:flex;gap:4px}
.tile-chips span{width:24px;height:24px;border-radius:4px;border:1px solid var(--rule)}
.tile-demo{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:2px}
.tile-id{font-family:var(--font-mono);font-size:.625rem;color:var(--ink-faint)}
</style>
<h1>Theme Matrix</h1>
<p class="ds-lede">One token vocabulary, ${themes.length} palettes, two families. CRT themes keep the
scanline overlay and mono chrome; universal themes drop both. Each tile below is a plain
<code>&lt;div data-theme="…"&gt;</code> — the same mechanism the app uses on <code>&lt;html&gt;</code>.
The button and tag are live, so the palette is visible in use rather than as chips alone.</p>
<div class="ds-grid mx">
${themes.map(tile).join("\n")}
</div>
<p class="ds-note">Authoring a 12th theme means overriding the eight base tokens
(${["--phosphor", "--phosphor-bright", "--phosphor-dim", "--phosphor-ink", "--phosphor-rgb", "--ink-rgb", "--ink", "--ink-em"].map((t) => `<code>${t}</code>`).join(", ")})
in a <code>html[data-theme="…"]</code> block, plus a row in <code>src/lib/theme.ts</code>. Everything
else derives. ${Object.keys(cssThemes).length} such blocks exist today.</p>
`);
}

function parseFontFaces(css) {
  const out = [];
  for (const m of css.matchAll(/@font-face\s*\{/g)) {
    const body = blockAt(css, css.indexOf("{", m.index));
    const family = body.match(/font-family:\s*'([^']+)'/)?.[1];
    const weight = body.match(/font-weight:\s*([^;]+);/)?.[1].trim();
    const file = body.match(/url\(['"]?\.\/assets\/fonts\/([^'")]+)['"]?\)/)?.[1];
    if (family) out.push({ family, weight, file });
  }
  return out;
}

// Each face's job, keyed by family. The app's four --font-* tokens are stacks; this is what actually
// renders at the front of each, and why.
const FACE_ROLES = {
  Lexend: ["--font-display + --font-body", "Headings and body prose. Chosen for reading-proficiency research — its word-shape spacing measurably improves reading speed and comprehension, which is a product decision for an app whose users read under bad conditions, not a style one."],
  "IBM Plex Mono": ["--font-mono", "UI chrome — buttons, tags, labels, metadata."],
  "Share Tech Mono": ["--font-lcd", "LCD readouts and text inputs. Dropped by the universal themes, which fall back to IBM Plex Mono."],
  VT323: ["boot only", "The blocky pixel face. Retired from the app UI in favour of Lexend, kept for the boot sequence and splash."],
  Inter: ["fallback only", "Never renders — it sits behind Lexend in both stacks it appears in. Present so the fallback chain is honest, and carried here only as a specimen."],
};

function typographyCard(root, faces) {
  const byFamily = [...new Map(faces.map((f) => [f.family, f])).values()];
  const ramp = [
    [".5625rem", "9px", "micro labels"], [".625rem", "10px", "eyebrow headings, badges"],
    [".6875rem", "11px", "titlebar, dense chrome"], [".72rem", "11.5px", ".tag"],
    [".75rem", "12px", "captions, help text"], [".78rem", "12.5px", ".btn"],
    [".8125rem", "13px", "rail items"], [".875rem", "14px", "body, inputs"],
    [".9375rem", "15px", "card titles"], ["1.5rem", "24px", "card h1"],
  ];

  return page("Foundations/Type", "Typography", `
<style>
.face{border:1px solid var(--rule);border-radius:12px;padding:16px;background:var(--panel);margin-bottom:12px}
.face-hd{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.face-name{font-family:var(--font-display);font-size:1.0625rem;color:var(--phosphor)}
.face-tok{font-family:var(--font-mono);font-size:.625rem;color:var(--phosphor-ink);border:1px solid var(--phosphor-faint);
  border-radius:9999px;padding:2px 8px}
.face-wt{font-family:var(--font-mono);font-size:.625rem;color:var(--ink-faint)}
.face-why{font-size:.75rem;color:var(--ink-dim);line-height:1.5;margin:0 0 12px;max-width:70ch}
.spec{font-size:1.75rem;line-height:1.25;color:var(--ink-em);margin-bottom:4px}
.spec-sm{font-size:.8125rem;color:var(--ink-dim);letter-spacing:.01em}
.ramp{width:100%;border-collapse:collapse}
.ramp td{border-bottom:1px solid var(--rule);padding:7px 10px;vertical-align:baseline}
.ramp td:first-child{font-family:var(--font-mono);font-size:.6875rem;color:var(--phosphor-ink);white-space:nowrap;width:1%}
.ramp td:nth-child(2){font-family:var(--font-mono);font-size:.625rem;color:var(--ink-faint);white-space:nowrap;width:1%}
.ramp td:last-child{color:var(--ink-faint);font-size:.6875rem;text-align:right}
.stacks{font-family:var(--font-mono);font-size:.6875rem;line-height:2;color:var(--ink-dim)}
.stacks b{color:var(--phosphor-ink);font-weight:400}
</style>
<h1>Typography</h1>
<p class="ds-lede">Five bundled faces, all local woff2 — no CDN, because the app has to work with no network
at all. Four <code>--font-*</code> tokens select among them.</p>

<h2>The stacks</h2>
<div class="stacks">
${["--font-display", "--font-mono", "--font-lcd", "--font-body"]
  .map((t) => `<div><b>${t}</b> &nbsp;${esc(root[t] || "")}</div>`).join("\n")}
</div>

<h2>Faces</h2>
${byFamily.map((f) => {
  const [tok, why] = FACE_ROLES[f.family] || ["", ""];
  return `<div class="face">
  <div class="face-hd">
    <span class="face-name" style="font-family:'${f.family}'">${esc(f.family)}</span>
    ${tok ? `<span class="face-tok">${esc(tok)}</span>` : ""}
    <span class="face-wt">weight ${esc(f.weight || "400")}</span>
  </div>
  <p class="face-why">${esc(why)}</p>
  <div class="spec" style="font-family:'${f.family}'">Photosynthesis converts light into chemical energy.</div>
  <div class="spec-sm" style="font-family:'${f.family}'">ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 — ${esc("+-x/=<>%")}</div>
</div>`;
}).join("\n")}

<h2>Size ramp</h2>
<table class="ramp">
${ramp.map(([rem, px, use]) => `<tr><td>${rem}</td><td>${px}</td><td style="font-size:${rem};color:var(--ink)">The mitochondria is the powerhouse</td><td>${esc(use)}</td></tr>`).join("\n")}
</table>
<p class="ds-note">Uppercase eyebrow headings pair a small size with
<code>letter-spacing:.18em</code> and <code>--ink-faint</code>. That combination is the app's most
repeated typographic gesture.</p>
`);
}

function crtCard(root) {
  const knobs = [
    ["--crt-scanline-opacity", 0, 0.3, 0.005, "scanline strength"],
    ["--crt-vignette-opacity", 0, 1, 0.01, "corner darkening"],
    ["--crt-noise-opacity", 0, 0.2, 0.002, "film grain"],
    ["--crt-aberration", 0, 3, 0.1, "RGB fringe (px)", "px"],
  ];

  return page("Effects", "CRT Overlay Stack", `
<style>
/* The overlay is position:fixed in the app (it covers the window). Re-scope it into the demo frame so
   the card can show it contained, next to the knobs that drive it. */
.frame{position:relative;overflow:hidden;border:1px solid var(--rule);border-radius:12px;height:300px;
  background:var(--bg);padding:24px}
.frame .term-grid-bg,.frame .crt-stack{position:absolute}
.frame-content{position:relative;z-index:1}
.knobs{display:grid;gap:10px;grid-template-columns:1fr;margin-top:16px}
.knob{display:grid;grid-template-columns:190px 1fr 64px;gap:12px;align-items:center}
.knob label{font-family:var(--font-mono);font-size:.6875rem;color:var(--phosphor-ink)}
.knob .hint{font-size:.625rem;color:var(--ink-faint);display:block}
.knob output{font-family:var(--font-mono);font-size:.6875rem;color:var(--ink-dim);text-align:right}
.knob input{width:100%;accent-color:var(--phosphor)}
.layers{display:flex;gap:14px;flex-wrap:wrap;margin:12px 0}
.layers label{display:flex;gap:6px;align-items:center;font-family:var(--font-mono);font-size:.6875rem;color:var(--ink-dim)}
.layers input{accent-color:var(--phosphor)}
</style>
<h1>CRT Overlay Stack</h1>
<p class="ds-lede">Four fixed layers plus a masked grid field, sitting above the whole window. This is the
single most identifying thing about OpenEdu — any generated full-screen surface needs it or it isn't the
same product. <code>.crt-scanlines</code> and <code>.crt-flicker</code> use
<code>mix-blend-mode:screen</code>, which is what makes the phosphor bloom rather than just tint.</p>

<div class="layers">
${["term-grid-bg", "crt-scanlines", "crt-noise", "crt-flicker", "crt-vignette"]
  .map((c) => `<label><input type="checkbox" checked data-layer="${c}"> .${c}</label>`).join("\n")}
</div>

<div class="frame" id="frame">
  <div class="term-grid-bg"></div>
  <div class="crt-stack">
    <div class="crt-scanlines"></div><div class="crt-noise"></div>
    <div class="crt-flicker"></div><div class="crt-vignette"></div>
  </div>
  <div class="frame-content">
    <div style="font-family:var(--font-display);font-size:1.5rem;color:var(--phosphor)" class="phosphor-glow">Stoichiometry</div>
    <p style="color:var(--ink-dim);font-size:.8125rem;max-width:44ch;line-height:1.6">Balance the equation, then
    convert grams to moles using molar mass. The mole ratio comes from the coefficients.</p>
    <div class="ds-row"><button class="btn btn-primary">Continue</button><span class="tag">Level 3</span></div>
  </div>
</div>

<div class="knobs">
${knobs.map(([tok, min, max, step, hint, unit]) => `  <div class="knob">
    <label>${tok}<span class="hint">${esc(hint)}</span></label>
    <input type="range" min="${min}" max="${max}" step="${step}" value="${parseFloat(root[tok])}"
           data-token="${tok}" data-unit="${unit || ""}">
    <output>${esc(root[tok])}</output>
  </div>`).join("\n")}
</div>

<h2>Resulting tokens</h2>
<pre class="ds-code" id="emit"></pre>
<p class="ds-note">The kill switch is <code>.crt-off</code> on <code>&lt;html&gt;</code>, which sets
<code>display:none</code> on <code>.crt-stack</code> and <code>.term-grid-bg</code>. Universal themes
force it on. Any surface that reproduces this stack must reproduce the escape hatch too — the lines are
overbearing for some readers, and that is a readability requirement, not a preference.</p>

<script>
const frame = document.getElementById('frame'), emit = document.getElementById('emit');
const knobs = [...document.querySelectorAll('.knob input')];
function render() {
  emit.textContent = ':root {\\n' + knobs.map(k =>
    '  ' + k.dataset.token + ': ' + k.value + k.dataset.unit + ';').join('\\n') + '\\n}';
}
knobs.forEach(k => k.addEventListener('input', () => {
  frame.style.setProperty(k.dataset.token, k.value + k.dataset.unit);
  k.parentElement.querySelector('output').textContent = k.value + k.dataset.unit;
  render();
}));
document.querySelectorAll('.layers input').forEach(box => box.addEventListener('change', () => {
  frame.querySelector('.' + box.dataset.layer).style.display = box.checked ? '' : 'none';
}));
render();
</script>
`);
}

// ── build ──────────────────────────────────────────────────────────────────────────────────────────

async function readAuthored() {
  let names = [];
  try {
    names = (await readdir(AUTHORED)).filter((f) => f.endsWith(".html"));
  } catch {
    return []; // no authored cards yet — fine
  }
  const cards = [];
  for (const file of names.sort()) {
    const raw = await readFile(path.join(AUTHORED, file), "utf8");
    const [first, ...rest] = raw.split(/\r?\n/); // CRLF: a stray \r here would break card detection
    const m = first.match(/^<!--\s*@dsCard\s+group="([^"]+)"\s*-->/);
    if (!m) {
      throw new Error(`build-design-system: ${file} line 1 must be \`<!-- @dsCard group="…" -->\`, got: ${first.slice(0, 60)}`);
    }
    const group = m[1];
    const title = group.split("/").pop();
    // Opt into the full face set with `<!-- @dsAssets all -->` as line 2, and only line 2. Scanning the
    // whole file for the directive means any card that DOCUMENTS it also triggers it — which is exactly
    // what the scaffold card did, silently gaining 88 KiB of fonts it never renders.
    const assets = /^<!--\s*@dsAssets\s+all\s*-->/.test(rest[0] ?? "") ? ALL : CORE;
    cards.push({ slug: file.replace(/\.html$/, ""), html: page(group, title, rest.join("\n")), assets });
  }
  return cards;
}

async function main() {
  const css = await readFile(CSS_SRC, "utf8");
  const ts = await readFile(THEME_SRC, "utf8");

  const { root, themes: cssThemes } = parseCss(css);
  const themes = parseThemes(ts);

  // 9 CSS blocks + the implicit `openedu` default, which has no block because it IS :root.
  if (Object.keys(cssThemes).length + 1 !== themes.length) {
    throw new Error(`build-design-system: ${Object.keys(cssThemes).length} [data-theme] blocks in index.css but ${themes.length} entries in theme.ts — they must agree (openedu has no block; it is :root).`);
  }
  for (const t of themes) {
    if (t.id !== "openedu" && !cssThemes[t.id]) {
      throw new Error(`build-design-system: theme "${t.id}" is in theme.ts but has no html[data-theme="${t.id}"] block in index.css`);
    }
  }

  const cards = [
    { slug: "foundations-palette", html: paletteCard(root), assets: CORE },
    { slug: "foundations-themes", html: themeMatrixCard(themes, cssThemes), assets: CORE },
    // ALL: this is the one card that must show every face, including the two the UI never renders.
    { slug: "foundations-typography", html: typographyCard(root, parseFontFaces(css)), assets: ALL },
    { slug: "effects-crt", html: crtCard(root), assets: CORE },
    ...(await readAuthored()),
  ];

  await mkdir(OUT, { recursive: true });

  // Cache one shell per distinct asset set — building it inlines megabytes of base64.
  const shells = new Map();
  const written = new Set();
  for (const card of cards) {
    const key = card.assets.join(",");
    if (!shells.has(key)) shells.set(key, await buildShell(css, card.assets, root));
    const html = card.html.replace("__SHELL__", () => shells.get(key));

    const bytes = Buffer.byteLength(html, "utf8");
    if (bytes > MAX_CARD_BYTES) {
      throw new Error(`build-design-system: ${card.slug} is ${(bytes / 1024).toFixed(0)} KiB, over the ${MAX_CARD_BYTES / 1024} KiB cap. Drop an asset from its set.`);
    }

    await writeFile(path.join(OUT, `${card.slug}.html`), html, "utf8");
    written.add(`${card.slug}.html`);
    console.log(`  ${card.slug.padEnd(28)} ${(bytes / 1024).toFixed(0).padStart(4)} KiB  [${card.assets.length} assets]`);
  }

  // Prune stale cards only — never rm -rf the directory, a hosted tool may keep state alongside.
  for (const f of await readdir(OUT)) {
    if (f.endsWith(".html") && !written.has(f)) {
      await unlink(path.join(OUT, f));
      console.log(`  pruned ${f}`);
    }
  }

  console.log(`\n[design] ${cards.length} cards → design/dist/`);
}

await main();
