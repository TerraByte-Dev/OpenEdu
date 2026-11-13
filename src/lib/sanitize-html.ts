// Every string the app inlines with dangerouslySetInnerHTML passes through here first. Model output,
// lessons and library resources are untrusted: a reply containing <img onerror>, <script>, <iframe>
// or a javascript: link must come out inert. DOMPurify's defaults allow HTML, SVG and MathML without
// scripts, event handlers or dangerous URLs; the two MathML tags below are what KaTeX emits for its
// screen-reader copy of each formula (<semantics> + a text-only <annotation> holding the TeX source;
// `encoding` is already a default MathML attribute). <annotation-xml> stays forbidden: it is the
// MathML-to-HTML integration point used in mXSS attacks.
//
// DOMPurify's defaults still keep some tags that are inert to script but not harmless here: <style> is
// global CSS (one reply can blank the app or @import from any host), <form>/<input>/<button> make a
// PIN-phishing form that posts off the machine, and <base>/<meta>/<link> change how the page resolves
// and loads. Neither KaTeX nor GFM emits them, with one exception: GFM task lists render
// <input type="checkbox" disabled>, so a disabled checkbox is the only <input> allowed through.
// Inline `style` attributes stay (KaTeX positions with them), but a position other than relative or
// static is removed: position:fixed/absolute/sticky would let one reply cover the whole app.
import DOMPurify, { type DOMPurify as Purifier } from "dompurify";

const HTML_CONFIG = {
  ADD_TAGS: ["semantics", "annotation"],
  FORBID_TAGS: ["style", "form", "button", "textarea", "select", "base", "meta", "link"],
};

// A private instance, so the <input> hook never touches the shared default instance Mermaid uses.
// Created on first use: the module is also imported by node-environment code with no window.
let htmlPurifier: Purifier | undefined;

function purifier(): Purifier {
  if (!htmlPurifier) {
    htmlPurifier = DOMPurify(window);
    htmlPurifier.addHook("afterSanitizeAttributes", (node) => {
      if (node.nodeName === "INPUT" && !((node as Element).getAttribute("type") === "checkbox" && (node as Element).hasAttribute("disabled"))) {
        node.parentNode?.removeChild(node);
        return;
      }
      // Inline position:fixed/absolute/sticky lets one reply lay a full-window overlay over the app.
      // KaTeX only emits position:relative.
      const style = (node as HTMLElement).style;
      if (style?.position && style.position !== "relative" && style.position !== "static") style.removeProperty("position");
    });
  }
  return htmlPurifier;
}

export function sanitizeHtml(html: string): string {
  return purifier().sanitize(html, HTML_CONFIG);
}

// Library card SVGs (Resources tab "diagram" view). SVG profile only, so no HTML elements; <style>
// survives (the generator uses it for theming), <script>, <foreignObject> and on* handlers do not.
export function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
}
