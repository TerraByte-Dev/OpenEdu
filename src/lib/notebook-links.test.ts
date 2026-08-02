import { describe, it, expect } from "vitest";
import {
  findWikiLinks,
  findTags,
  extractTags,
  extractWikiTitles,
  linkKey,
  resolveWikiLink,
  buildTagIndex,
  buildVaultGraph,
  folderNodeId,
  tagNodeId,
  buildBacklinkIndex,
  findUnlinkedMentions,
  extractOutline,
} from "./notebook-links";
import type { Note, NotebookFolder } from "../types";

// ── Test fixtures ───────────────────────────────────────────────────────────
let seq = 0;
function note(partial: Partial<Note> & { title: string; content: string }): Note {
  seq += 1;
  return {
    id: partial.id ?? `note-${seq}`,
    course_id: "c1",
    level: 0,
    title: partial.title,
    content: partial.content,
    sort_order: 0,
    parent_id: null,
    folder_id: partial.folder_id ?? null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  };
}
function folder(id: string, name: string, parent_id: string | null = null): NotebookFolder {
  return { id, course_id: "c1", name, parent_id, sort_order: 0, created_at: "2026-01-01" };
}

describe("findTags", () => {
  it("finds a tag at the start of the text", () => {
    expect(findTags("#alpha rest")).toEqual([{ tag: "alpha", start: 0, end: 6 }]);
  });

  it("finds tags after whitespace and anchors the span at the #", () => {
    // "see #beta now" — the # is at index 4.
    expect(findTags("see #beta now")).toEqual([{ tag: "beta", start: 4, end: 9 }]);
  });

  it("requires a boundary before the # (mid-word # is not a tag)", () => {
    expect(findTags("C#")).toEqual([]);
    expect(findTags("a#b")).toEqual([]);
    expect(findTags("color#fff")).toEqual([]);
  });

  it("requires a letter to lead the tag (so #1 / #_x are not tags)", () => {
    expect(findTags("#123")).toEqual([]);
    expect(findTags("#_private")).toEqual([]);
  });

  it("allows hyphens, underscores, and digits after the leading letter", () => {
    expect(findTags("#data-structures_v2").map((t) => t.tag)).toEqual(["data-structures_v2"]);
  });

  it("finds multiple adjacent tags", () => {
    expect(findTags("#a #b #c").map((t) => t.tag)).toEqual(["a", "b", "c"]);
  });

  it("treats the tag as ending at the first non-word char", () => {
    // trailing punctuation is not part of the tag
    expect(findTags("#topic. done").map((t) => ({ tag: t.tag, start: t.start, end: t.end }))).toEqual([
      { tag: "topic", start: 0, end: 6 },
    ]);
  });
});

describe("findWikiLinks", () => {
  it("extracts the title and bracket-inclusive span", () => {
    expect(findWikiLinks("see [[Cells]] here")).toEqual([{ title: "Cells", start: 4, end: 13 }]);
  });

  it("trims inner whitespace from the title", () => {
    expect(findWikiLinks("[[  Spaced Title  ]]")[0].title).toBe("Spaced Title");
  });

  it("finds multiple links in order", () => {
    expect(findWikiLinks("[[One]] then [[Two]]").map((l) => l.title)).toEqual(["One", "Two"]);
  });

  it("ignores an unclosed bracket run", () => {
    expect(findWikiLinks("[[unterminated")).toEqual([]);
  });
});

describe("extractTags", () => {
  it("returns unique tags in first-seen order, case preserved", () => {
    expect(extractTags("#Bio note #cells then #Bio again #ATP")).toEqual(["Bio", "cells", "ATP"]);
  });

  it("is empty when there are no tags", () => {
    expect(extractTags("just prose, no tags, an email a@b.com")).toEqual([]);
  });
});

describe("extractWikiTitles", () => {
  it("dedupes case-insensitively but preserves the first-seen casing", () => {
    expect(extractWikiTitles("[[Mitosis]] ... [[mitosis]] ... [[Meiosis]]")).toEqual(["Mitosis", "Meiosis"]);
  });
});

describe("linkKey / resolveWikiLink", () => {
  it("normalizes by trim + lowercase", () => {
    expect(linkKey("  Photosynthesis ")).toBe("photosynthesis");
  });

  it("resolves a title to a note case-insensitively, or null", () => {
    const notes = [note({ title: "Photosynthesis", content: "" }), note({ title: "ATP", content: "" })];
    expect(resolveWikiLink("photosynthesis", notes)?.title).toBe("Photosynthesis");
    expect(resolveWikiLink("Nonexistent", notes)).toBeNull();
  });
});

describe("buildTagIndex", () => {
  it("maps each tag to every note that carries it", () => {
    const a = note({ title: "A", content: "#bio #cells" });
    const b = note({ title: "B", content: "#bio only" });
    const c = note({ title: "C", content: "no tags" });
    const idx = buildTagIndex([a, b, c]);
    expect(idx.get("bio")?.map((n) => n.title)).toEqual(["A", "B"]);
    expect(idx.get("cells")?.map((n) => n.title)).toEqual(["A"]);
    expect(idx.has("nope")).toBe(false);
  });

  it("counts a note once per distinct tag even if repeated", () => {
    const a = note({ title: "A", content: "#bio #bio #bio" });
    expect(buildTagIndex([a]).get("bio")?.length).toBe(1);
  });
});

describe("buildVaultGraph", () => {
  it("creates a distinct tag node per tag with note->tag edges, and never a note for the tag", () => {
    const a = note({ id: "na", title: "Alpha", content: "studying #bio and #cells" });
    const b = note({ id: "nb", title: "Beta", content: "more #bio" });
    const g = buildVaultGraph([a, b], []);

    const tagNodes = g.nodes.filter((n) => n.kind === "tag");
    expect(tagNodes.map((n) => n.title).sort()).toEqual(["#bio", "#cells"]);
    expect(g.nodes.filter((n) => n.kind === "note").length).toBe(2); // exactly the 2 real notes

    // note->tag edges exist via adjacency
    expect(g.adjacency.get("na")?.has(tagNodeId("bio"))).toBe(true);
    expect(g.adjacency.get("nb")?.has(tagNodeId("bio"))).toBe(true);
    // #bio is shared by both notes => degree 2
    expect(tagNodes.find((n) => n.title === "#bio")?.degree).toBe(2);
  });

  it("adds note<->note edges for [[wikilinks]] (case-insensitive, self-link ignored)", () => {
    const a = note({ id: "na", title: "Alpha", content: "see [[beta]] and [[Alpha]]" });
    const b = note({ id: "nb", title: "Beta", content: "" });
    const g = buildVaultGraph([a, b], []);
    expect(g.adjacency.get("na")?.has("nb")).toBe(true);
    expect(g.adjacency.get("na")?.has("na")).toBeFalsy(); // self-link dropped
  });

  it("hangs notes off their folder and nests folders under their parent", () => {
    const root = folder("f1", "Root");
    const child = folder("f2", "Child", "f1");
    const a = note({ id: "na", title: "A", content: "", folder_id: "f2" });
    const g = buildVaultGraph([a], [root, child]);
    expect(g.adjacency.get("na")?.has(folderNodeId("f2"))).toBe(true);
    expect(g.adjacency.get(folderNodeId("f2"))?.has(folderNodeId("f1"))).toBe(true);
  });

  it("produces only note + folder + tag node kinds", () => {
    const a = note({ id: "na", title: "A", content: "#x", folder_id: "f1" });
    const g = buildVaultGraph([a], [folder("f1", "F")]);
    expect(new Set(g.nodes.map((n) => n.kind))).toEqual(new Set(["note", "folder", "tag"]));
  });
});

describe("buildBacklinkIndex", () => {
  it("maps a target to the notes linking at it", () => {
    const a = note({ id: "na", title: "Alpha", content: "see [[Beta]]" });
    const b = note({ id: "nb", title: "Beta", content: "nothing here" });
    const idx = buildBacklinkIndex([a, b]);
    expect(idx.get("nb")!.map((m) => m.note.id)).toEqual(["na"]);
    expect(idx.has("na")).toBe(false);
  });

  it("resolves case-insensitively, like the link syntax itself", () => {
    const a = note({ id: "na", title: "Alpha", content: "see [[beta]]" });
    const b = note({ id: "nb", title: "Beta", content: "" });
    expect(buildBacklinkIndex([a, b]).get("nb")!).toHaveLength(1);
  });

  it("groups repeated links from one note into a single entry with several contexts", () => {
    const a = note({ id: "na", title: "Alpha", content: "first [[Beta]]\nthen [[Beta]] again" });
    const b = note({ id: "nb", title: "Beta", content: "" });
    const hits = buildBacklinkIndex([a, b]).get("nb")!;
    expect(hits).toHaveLength(1);
    expect(hits[0].contexts).toEqual(["first [[Beta]]", "then [[Beta]] again"]);
  });

  it("ignores self-links", () => {
    const a = note({ id: "na", title: "Alpha", content: "[[Alpha]] refers to itself" });
    expect(buildBacklinkIndex([a]).has("na")).toBe(false);
  });

  it("ignores links whose target does not exist", () => {
    const a = note({ id: "na", title: "Alpha", content: "[[Nowhere]]" });
    expect(buildBacklinkIndex([a]).size).toBe(0);
  });

  it("elides a long context around the hit rather than returning the whole line", () => {
    const pad = "x ".repeat(120);
    const a = note({ id: "na", title: "Alpha", content: `${pad}[[Beta]]${pad}` });
    const b = note({ id: "nb", title: "Beta", content: "" });
    const ctx = buildBacklinkIndex([a, b]).get("nb")![0].contexts[0];
    expect(ctx.startsWith("…")).toBe(true);
    expect(ctx.endsWith("…")).toBe(true);
    expect(ctx).toContain("[[Beta]]");
    expect(ctx.length).toBeLessThan(240);
  });
});

describe("findUnlinkedMentions", () => {
  const target = note({ id: "nt", title: "Photosynthesis", content: "" });

  it("finds a plain-prose mention of the title", () => {
    const other = note({ id: "no", title: "Leaves", content: "Photosynthesis happens here." });
    const hits = findUnlinkedMentions(target, [target, other]);
    expect(hits.map((m) => m.note.id)).toEqual(["no"]);
    expect(hits[0].contexts).toEqual(["Photosynthesis happens here."]);
  });

  it("does not count a mention that is already linked", () => {
    const other = note({ id: "no", title: "Leaves", content: "see [[Photosynthesis]]" });
    expect(findUnlinkedMentions(target, [target, other])).toEqual([]);
  });

  it("counts only the unlinked occurrence when a note has both", () => {
    const other = note({ id: "no", title: "Leaves", content: "[[Photosynthesis]] and photosynthesis again" });
    const hits = findUnlinkedMentions(target, [target, other]);
    expect(hits[0].contexts).toHaveLength(1);
    expect(hits[0].contexts[0]).toContain("again");
  });

  it("is case-insensitive but whole-word only", () => {
    const yes = note({ id: "y", title: "Y", content: "PHOTOSYNTHESIS rules" });
    const no = note({ id: "n", title: "N", content: "Photosynthesises and photosynthesis-like" });
    expect(findUnlinkedMentions(target, [target, yes]).map((m) => m.note.id)).toEqual(["y"]);
    expect(findUnlinkedMentions(target, [target, no])).toEqual([]);
  });

  it("never reports the target itself", () => {
    const self = note({ id: "nt2", title: "Photosynthesis", content: "Photosynthesis is me" });
    expect(findUnlinkedMentions(self, [self])).toEqual([]);
  });

  it("skips titles too short to be meaningful", () => {
    const short = note({ id: "s", title: "AI", content: "" });
    const other = note({ id: "o", title: "O", content: "AI everywhere, AI again" });
    expect(findUnlinkedMentions(short, [short, other])).toEqual([]);
  });

  it("treats a title with regex metacharacters literally", () => {
    const weird = note({ id: "w", title: "C++ (basics)", content: "" });
    const other = note({ id: "o", title: "O", content: "notes on C++ (basics) today" });
    expect(findUnlinkedMentions(weird, [weird, other]).map((m) => m.note.id)).toEqual(["o"]);
  });
});

describe("extractOutline", () => {
  it("returns headings with level, text, and line", () => {
    expect(extractOutline("# One\n\ntext\n## Two\n### Three")).toEqual([
      { level: 1, text: "One", line: 0 },
      { level: 2, text: "Two", line: 3 },
      { level: 3, text: "Three", line: 4 },
    ]);
  });

  it("ignores headings inside fenced code blocks", () => {
    const md = "# Real\n\n```sh\n# not a heading\n```\n\n## Also real";
    expect(extractOutline(md).map((h) => h.text)).toEqual(["Real", "Also real"]);
  });

  it("closes a fence only on a matching fence character", () => {
    const md = "```\n# hidden\n~~~\n# still hidden\n```\n# visible";
    expect(extractOutline(md).map((h) => h.text)).toEqual(["visible"]);
  });

  it("strips trailing closing hashes", () => {
    expect(extractOutline("## Title ##")).toEqual([{ level: 2, text: "Title", line: 0 }]);
  });

  it("requires a space after the hashes", () => {
    expect(extractOutline("#nospace\n#tag here")).toEqual([]);
  });

  it("handles CRLF", () => {
    expect(extractOutline("# A\r\n## B").map((h) => h.line)).toEqual([0, 1]);
  });
});
