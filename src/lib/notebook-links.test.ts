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
