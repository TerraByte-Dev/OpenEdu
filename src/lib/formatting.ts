// Shared output-formatting rules appended to LLM prompts.
//
// Direction (per HANDOFF 2026-05-14): suppression, not rendering. Small local
// models (gemma4:e4b floor) cannot reliably emit doubly-escaped LaTeX inside
// JSON strings — one backslash drops out and the JSON either fails to parse or
// silently corrupts (\text{c} → <TAB>ext{c}). Steer the model to plain-text
// math everywhere; KaTeX/MathJax stays off until the floor model moves up.

// For prompts whose output is a JSON document. The body mirrors the block that
// shipped in buildTopicListPrompt / buildExpansionPrompt — those two now import
// this constant so the rule has a single source of truth.
export const MATH_FORMATTING_RULES = `## Math/formatting
- Use plain-text math only: × ÷ ² ³ π ≤ ≥ √ Δ θ α β μ σ Σ ∫ ∂.
- Do NOT use LaTeX, backslash commands (no \\text, \\frac, \\alpha, \\sum, ...), or $...$ delimiters.
- No backslashes anywhere in any string field.`;

// For prompts whose output is conversational prose (tutor chat, streamed
// study plan). Same intent, framed for narrative output.
export const MATH_FORMATTING_RULES_PROSE = `Format all math as plain text — use × ÷ ² ³ π ≤ ≥ √ Δ θ α β μ σ Σ ∫ ∂ directly. Do not use LaTeX, backslash commands (\\frac, \\vec, \\alpha, \\mathbb, \\langle, ...), or $...$ / $$...$$ math delimiters. Never include backslashes in your output.`;
