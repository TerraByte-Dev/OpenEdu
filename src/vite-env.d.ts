/// <reference types="vite/client" />

// KaTeX ships its mhchem extension without types; the dynamic import() in chat-markdown.ts (lazy
// KaTeX) needs this ambient declaration. It's a side-effect module that registers \ce{} on KaTeX.
declare module "katex/contrib/mhchem";
