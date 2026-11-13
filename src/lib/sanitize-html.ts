// Every string the app inlines with dangerouslySetInnerHTML passes through here first. Model output,
// lessons and library resources are untrusted: a reply containing <img onerror>, <script>, <iframe>
// or a javascript: link must come out inert. DOMPurify's defaults allow HTML, SVG and MathML without
// scripts, event handlers or dangerous URLs; the two MathML tags below are what KaTeX emits for its
// screen-reader copy of each formula (<semantics> + a text-only <annotation> holding the TeX source).
// <annotation-xml> stays forbidden: it is the MathML-to-HTML integration point used in mXSS attacks.
import DOMPurify from "dompurify";

const KATEX_MATHML = { ADD_TAGS: ["semantics", "annotation"], ADD_ATTR: ["encoding"] };

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, KATEX_MATHML);
}

// Library card SVGs (Resources tab "diagram" view). SVG profile only, so no HTML elements; <style>
// survives (the generator uses it for theming), <script>, <foreignObject> and on* handlers do not.
export function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
}
