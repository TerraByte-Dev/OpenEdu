// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import OutsideLinkNote from "./OutsideLinkNote";
import { renderChatMarkdown } from "../lib/chat-markdown";
import { OUTSIDE_LINK_LINE } from "../lib/link-guard";
import { downloadSettingsFile } from "../lib/settings-io";
import { EXPORT_KIND, EXPORT_VERSION, type SettingsExport } from "../lib/settings-schema";
import appSource from "../App.tsx?raw";

// settings-io reads the Tauri store when it gathers settings; the download itself never does.
vi.mock("@tauri-apps/plugin-store", () => ({ Store: { load: vi.fn() } }));

// The real OutsideLinkNote, as App mounts it, over prose rendered by renderChatMarkdown, the path chat,
// lessons, Raise hand and resources take. A click that leaves the app must be cancelled (so the window
// stays on OpenEdu) and its address shown; a same-page #anchor must not be touched.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let app: HTMLDivElement;
let prose: HTMLDivElement;

beforeEach(async () => {
  app = document.createElement("div");
  prose = document.createElement("div");
  document.body.append(app, prose);
  root = createRoot(app);
  await act(async () => root.render(createElement(OutsideLinkNote)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
  prose.remove();
});

function show(markdown: string) {
  prose.innerHTML = renderChatMarkdown(markdown);
}

/** Dispatches a mouse event on the element and says whether the page let it through. */
async function press(el: Element, init: MouseEventInit & { type?: string } = {}): Promise<boolean> {
  let allowed = true;
  await act(async () => {
    allowed = el.dispatchEvent(new MouseEvent(init.type ?? "click", { bubbles: true, cancelable: true, ...init }));
  });
  return allowed;
}

const note = () => app.querySelector('[role="status"]');

describe("a link in rendered prose", () => {
  it("to another site is cancelled and its address shown to copy", async () => {
    show("Learn more at [Khan Academy](https://www.khanacademy.org/math).");
    expect(note()).toBeNull();
    expect(await press(prose.querySelector("a")!)).toBe(false);
    expect(note()!.textContent).toContain(OUTSIDE_LINK_LINE);
    expect(note()!.textContent).toContain("https://www.khanacademy.org/math");
  });

  it("written as a bare address (GFM makes it a link) is cancelled too", async () => {
    show("See www.example.org for more.");
    const a = prose.querySelector("a")!;
    expect(a).not.toBeNull();
    expect(await press(a)).toBe(false);
    expect(note()!.textContent).toContain("http://www.example.org/");
  });

  it("is cancelled when clicked on an element inside it", async () => {
    show("[**bold** link](https://example.com/)");
    expect(await press(prose.querySelector("a strong")!)).toBe(false);
    expect(note()!.textContent).toContain("https://example.com/");
  });

  it("with ctrl, shift or the middle button is cancelled (no new window)", async () => {
    show("[x](https://example.com/)");
    const a = prose.querySelector("a")!;
    expect(await press(a, { ctrlKey: true })).toBe(false);
    expect(await press(a, { shiftKey: true })).toBe(false);
    expect(await press(a, { type: "auxclick", button: 1 })).toBe(false);
  });

  it("to a #anchor on the same page goes through", async () => {
    show("Jump to [the steps](#steps).");
    expect(await press(prose.querySelector("a")!)).toBe(true);
    expect(note()).toBeNull();
  });

  it("in a diagram (an SVG <a> with xlink:href) is cancelled", async () => {
    prose.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="https://example.net/"><text>node</text></a></svg>';
    expect(await press(prose.querySelector("text")!)).toBe(false);
    expect(note()!.textContent).toContain("https://example.net/");
  });

  it("dismissed, the note goes away and the next link brings it back", async () => {
    show("[x](https://example.com/one)");
    await press(prose.querySelector("a")!);
    await press(app.querySelector('button[aria-label="Dismiss"]')!);
    expect(note()).toBeNull();
    show("[y](https://example.com/two)");
    expect(await press(prose.querySelector("a")!)).toBe(false);
    expect(note()!.textContent).toContain("https://example.com/two");
  });

  // Ported from TerraTutor #231: Copy was bare text and the dismiss a bare ✕ glyph.
  it("offers Copy as a 44px pill and the dismiss as a 44px round target", async () => {
    show("[x](https://example.com/one)");
    await press(prose.querySelector("a")!);
    const copy = [...note()!.querySelectorAll("button")].find((b) => b.textContent === "Copy")!;
    expect(copy.classList.contains("btn")).toBe(true);
    const dismiss = note()!.querySelector('button[aria-label="Dismiss"]')!;
    expect(dismiss.className.split(" ")).toContain("w-11");
    expect(dismiss.className.split(" ")).toContain("h-11");
  });

  it("anywhere else on the page is left alone", async () => {
    show("No links here.");
    expect(await press(prose.querySelector("p")!)).toBe(true);
    expect(note()).toBeNull();
  });
});

describe("a link to the app's own pages", () => {
  it("is cancelled without a note: it would reload OpenEdu and lose the learner's place", async () => {
    for (const href of ["/", "steps.html", "./page"]) {
      show(`[x](${href})`);
      expect(await press(prose.querySelector("a")!)).toBe(false);
      expect(note()).toBeNull();
    }
  });
});

describe("Settings › About › Download .json", () => {
  it("saves the file: the guard lets the app's own download through", async () => {
    let made = "";
    URL.createObjectURL = () => (made = `blob:${location.protocol}//${location.host}/5e771265`);
    URL.revokeObjectURL = () => undefined;
    const clicks: { href: string | null; download: string | null; prevented: boolean }[] = [];
    const record = (e: Event) => {
      const a = e.target as HTMLAnchorElement;
      clicks.push({ href: a.getAttribute("href"), download: a.getAttribute("download"), prevented: e.defaultPrevented });
      e.preventDefault(); // jsdom can't save a file; the record above was taken first
    };
    document.addEventListener("click", record);
    const payload: SettingsExport = {
      kind: EXPORT_KIND, version: EXPORT_VERSION, exportedAt: "2026-11-18T00:00:00.000Z", theme: "light", settings: {}, permissions: {},
    };
    try {
      await act(async () => downloadSettingsFile(payload));
    } finally {
      document.removeEventListener("click", record);
    }
    expect(clicks).toHaveLength(1);
    expect(clicks[0].href).toBe(made);
    expect(clicks[0].download).toMatch(/2026-11-18\.json$/);
    expect(clicks[0].prevented).toBe(false);
    expect(note()).toBeNull();
  });
});

describe("Switch learner", () => {
  it("App keys the outside-link note by the active learner", () => {
    expect(appSource).toContain('<OutsideLinkNote key={activeLearner?.id ?? "none"} />');
    expect(appSource.match(/<OutsideLinkNote\b/g)).toHaveLength(1);
  });

  it("(a new key) clears an address one learner clicked, and the link guard still works after", async () => {
    await act(async () => root.render(createElement(OutsideLinkNote, { key: "l1" })));
    show("Learn more at [Khan Academy](https://www.khanacademy.org/math).");
    expect(await press(prose.querySelector("a")!)).toBe(false);
    expect(note()!.textContent).toContain("https://www.khanacademy.org/math");
    // Switch learner: App sets the active learner to null (the picker), then to the next learner.
    await act(async () => root.render(createElement(OutsideLinkNote, { key: "none" })));
    expect(note()).toBeNull();
    await act(async () => root.render(createElement(OutsideLinkNote, { key: "l2" })));
    expect(note()).toBeNull();
    expect(await press(prose.querySelector("a")!)).toBe(false);
    expect(note()!.textContent).toContain(OUTSIDE_LINK_LINE);
  });
});
