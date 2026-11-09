# Offline dev data for levers 10 and 9g

It lives outside `src/` so the sealed-set leak check (`sealed.test.ts`), which scans `src/`, does not
read it.

`dev-long.json` holds 12 long, realistic student notes (749 to 849 words, 35 chunks under `chunkText`)
with 48 positives and 36 near-misses. An agent wrote it for development on 2026-11-09. It is dev data:
lever 10's window (`src/lib/kernel/ground.ts` `passageFor`) and lever 9g's threshold (`src/lib/kernel/meaning.ts`) were chosen
on it, together with the older dev sets. It is not a test set and no model was run on it.

The numbers in PR #227 and PR #228 come from an offline simulation with no chat model:
- chunk each note with `chunkText`;
- embed the chunks and each question with nomic-embed-text;
- take the top 6 chunks by cosine;
- apply `selectHits` (floor 0.45, two per note, three hits);
- check whether the answer or the poison is in the text a model would be shown (`capText(..., 250)` or
  `passageFor`).

The simulation script is `long-notes-sim.ts`, committed on the 9g branch (#228). Run it with
`npx vite-node scripts/eval-offline/long-notes-sim.ts`, with Ollama serving nomic-embed-text.
