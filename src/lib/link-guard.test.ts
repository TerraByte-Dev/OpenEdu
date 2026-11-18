import { describe, it, expect } from "vitest";
import { linkLeavesApp, linkMayFollow } from "./link-guard";

// The pages the app is served from: Windows (WebView2), macOS/Linux, and the dev server.
const PAGES = ["http://tauri.localhost/", "tauri://localhost/index.html", "http://localhost:1420/"];

describe("linkLeavesApp", () => {
  it("lets a same-page #anchor and the app's own pages through", () => {
    for (const page of PAGES) {
      expect(linkLeavesApp("#step-2", page)).toBeNull();
      expect(linkLeavesApp("  #top", page)).toBeNull();
      expect(linkLeavesApp("/", page)).toBeNull();
      expect(linkLeavesApp("other.html#x", page)).toBeNull();
      expect(linkLeavesApp(new URL("/lessons", page).href, page)).toBeNull();
    }
  });

  it("returns the address of a link to another site, so it can be shown", () => {
    for (const page of PAGES) {
      expect(linkLeavesApp("http://www.khanacademy.org", page)).toBe("http://www.khanacademy.org/");
      expect(linkLeavesApp("https://example.com/a?b=c#d", page)).toBe("https://example.com/a?b=c#d");
      expect(linkLeavesApp("//example.com/x", page)).toMatch(/^[a-z]+:\/\/example\.com\/x$/);
      expect(linkLeavesApp("mailto:someone@example.com", page)).toBe("mailto:someone@example.com");
    }
  });

  it("treats another port, scheme or host on the same machine as leaving", () => {
    expect(linkLeavesApp("http://localhost:1421/", "http://localhost:1420/")).toBe("http://localhost:1421/");
    expect(linkLeavesApp("https://tauri.localhost/", "http://tauri.localhost/")).toBe("https://tauri.localhost/");
    expect(linkLeavesApp("http://tauri.localhost/", "tauri://localhost/")).toBe("http://tauri.localhost/");
    expect(linkLeavesApp("tauri://example.com/", "tauri://localhost/")).toBe("tauri://example.com/");
  });

  it("counts data: and blob: as leaving: as a navigation they would replace the app", () => {
    expect(linkLeavesApp("data:text/html,hi", "http://tauri.localhost/")).toBe("data:text/html,hi");
    expect(linkLeavesApp("blob:http://tauri.localhost/1234", "http://tauri.localhost/")).toBe("blob:http://tauri.localhost/1234");
  });

  it("shows an address that doesn't parse as written", () => {
    expect(linkLeavesApp(" http://[bad ", "http://tauri.localhost/")).toBe("http://[bad");
  });
});

describe("linkMayFollow", () => {
  it("lets a #anchor on the same page go ahead, written either way", () => {
    for (const page of PAGES) {
      expect(linkMayFollow("#steps", page, false)).toBe(true);
      expect(linkMayFollow(new URL("#steps", page).href, page, false)).toBe(true);
    }
  });

  it("stops any other link to the app's own origin: it would only reload the app", () => {
    for (const page of PAGES) {
      for (const href of ["/", "steps.html", "./page", "/other#steps", new URL("/lessons", page).href]) {
        expect(linkMayFollow(href, page, false)).toBe(false);
      }
    }
  });

  it("lets a download of the page's own blob: URL go ahead, and nothing else that is a blob: or data:", () => {
    for (const page of PAGES) {
      const own = `blob:${new URL(page).protocol}//${new URL(page).host}/0b1c`;
      expect(linkMayFollow(own, page, true)).toBe(true);
      expect(linkMayFollow(own, page, false)).toBe(false);
      expect(linkMayFollow("blob:https://example.com/0b1c", page, true)).toBe(false);
      expect(linkMayFollow("data:application/json,{}", page, true)).toBe(false);
      expect(linkMayFollow("https://example.com/file.json", page, true)).toBe(false);
    }
  });
});
