// A link in a tutor reply, a lesson, Raise hand help, a resource, a note or a diagram must never take the
// OpenEdu window away from the app. The window is frameless, so the app's own Titlebar holds the only
// window controls; a top-level navigation unloads it and leaves a child in an unfiltered browser with no
// way back or out. The link is written by a model or a document's author, so its site may be made up.
//
// One delegated listener on the document (installLinkGuard, mounted by components/OutsideLinkNote.tsx)
// cancels any click on a link that leaves the app and hands its address to the note, which shows it as
// text a grown-up can copy into a browser. The app opens no browser itself (no opener or shell
// capability). Two kinds of link go through untouched: a same-page #anchor, and a download the app makes
// itself (an <a download> to one of the page's own blob: URLs, settings-io.ts downloadSettingsFile), which
// saves a file and is not a navigation. Any other link to the app's own origin is cancelled without a
// note: the app has no pages to link to, so following it would only reload OpenEdu and lose the
// learner's lesson, quiz or chat. Rust is the backstop: src-tauri/src/nav_guard.rs cancels top-level
// navigations off the app's origin, and no new window (ctrl-, shift- or middle-click, target=_blank) is
// ever opened.

import { APP_NAME } from "./product";

/** The note's words, shown above the address. */
export const OUTSIDE_LINK_LINE = `Links don't open inside ${APP_NAME}. A grown-up can copy this one into a web browser:`;

/** Same origin, compared as protocol + host, as in remote-url.ts isLocalUrl (tauri://localhost's URL.origin is "null"). */
function sameOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.host === b.host;
}

/**
 * The address to show when following `href` would leave the app, or null when it stays: a same-page
 * #anchor, or a URL with the page's own protocol and host. data: and blob: leave too (as a navigation
 * they would replace the app). An href that doesn't parse is shown as written.
 */
export function linkLeavesApp(href: string, pageUrl: string): string | null {
  const v = href.trim();
  if (v.startsWith("#")) return null;
  try {
    const here = new URL(pageUrl);
    const url = new URL(v, here);
    if (sameOrigin(url, here)) return null;
    return url.href;
  } catch {
    return v;
  }
}

/**
 * True when a click on this link may go ahead: a #anchor on the page it is on, or (`download` set) a
 * download of a blob: URL the page itself made, whose inner origin is the page's.
 */
export function linkMayFollow(href: string, pageUrl: string, download: boolean): boolean {
  const v = href.trim();
  if (v.startsWith("#")) return true;
  try {
    const here = new URL(pageUrl);
    if (download && v.toLowerCase().startsWith("blob:")) return sameOrigin(new URL(v.slice(5)), here);
    const url = new URL(v, here);
    const withoutHash = (u: URL) => u.href.slice(0, u.href.length - u.hash.length).replace(/#$/, "");
    return v.includes("#") && withoutHash(url) === withoutHash(here);
  } catch {
    return false;
  }
}

const XLINK_NS = "http://www.w3.org/1999/xlink";

function clickedLink(target: EventTarget | null): { href: string; download: boolean } | null {
  const el = target as Element | null;
  const link = typeof el?.closest === "function" ? el.closest("a, area") : null;
  if (!link) return null;
  const href = link.getAttribute("href") ?? link.getAttributeNS(XLINK_NS, "href");
  return href === null ? null : { href, download: link.hasAttribute("download") };
}

/**
 * Cancels every click (and middle-click) on a link that may not be followed (linkMayFollow), in the
 * capture phase so nothing inside the page can stop it first, and calls `onOutside` with the address of
 * one that leaves the app. Returns the remover.
 */
export function installLinkGuard(doc: Document, onOutside: (address: string) => void): () => void {
  const guard = (e: Event) => {
    const link = clickedLink(e.target);
    if (link === null || linkMayFollow(link.href, doc.location.href, link.download)) return;
    e.preventDefault();
    const address = linkLeavesApp(link.href, doc.location.href);
    // auxclick also fires for a right button press; only a middle-click is someone trying to open it.
    if (address !== null && (e.type === "click" || (e as MouseEvent).button === 1)) onOutside(address);
  };
  doc.addEventListener("click", guard, { capture: true });
  doc.addEventListener("auxclick", guard, { capture: true });
  return () => {
    doc.removeEventListener("click", guard, { capture: true });
    doc.removeEventListener("auxclick", guard, { capture: true });
  };
}
