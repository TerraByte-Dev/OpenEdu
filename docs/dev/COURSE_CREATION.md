# How Course Creation Works in OpenEdu

## TL;DR

No `.md` files are generated. Everything lives in a single **SQLite database** (`openedu.db`) stored locally by Tauri. There is no file system footprint per-course — all curriculum data is rows in tables.

---

## The Pipeline (15 sequential steps)

When you hit **EXECUTE** on a new course, `Dashboard.tsx:handleCreate` runs these steps in order:

### Step 1 — Create course record
Inserts one row into the `courses` table (uuid, title, topic, `current_level = 0`).  
If anything later fails, this row is deleted as cleanup (`deleteCourse`).

### Step 2 — Research topic
`curriculum.ts:researchTopic` sends a big structured prompt to the LLM asking it to produce a curriculum research brief covering:
- Subject overview
- Key knowledge domains
- Full beginner → mastery learning progression
- Common obstacles
- Prerequisite knowledge

If a **Tavily API key** is set in Settings, a web search runs first and the results are injected into the research prompt as grounding context. The full research brief (~2,000–4,000 chars) is saved to `tutor_instructions` table under type `"research"`.

### Step 3 — Plan course structure
`curriculum.ts:generateCourseOutline` uses the research brief to generate a **strategic 11-level outline** covering levels 0.0 through 5.0. For each level it defines: title, focus areas, key outcomes, and a "bridge" to the next level. Level 5.0 is always a mastery exam with no new content. Saved to `tutor_instructions` under type `"course_outline"`.

### Step 4 — Design tutor persona
`curriculum.ts:generateTutorInstructions` generates 3 pieces saved to `tutor_instructions`:
- `"identity"` — tutor name, personality, teaching style
- `"pedagogy"` — how to structure explanations at each level
- `"rules"` — hard behavioral rules (stay in scope, no quiz answers, etc.)

### Steps 5–15 — Generate all 11 syllabuses
`curriculum.ts:generateSyllabus` runs once per level (0.0, 0.5, 1.0 … 5.0), each call receiving:
- The research brief (truncated to 2,000–3,000 chars)
- The course outline (truncated to 2,500 chars)
- All previously-generated syllabuses (to avoid repeating subtopics)

Each call asks the LLM to return **pure JSON** matching this shape:
```json
{
  "level": 0.5,
  "title": "...",
  "description": "...",
  "learning_objectives": ["...", "..."],
  "subtopics": [
    { "id": "0.5.1", "title": "...", "key_concepts": ["..."], "practice_type": "reading", "mastered": false }
  ],
  "assessment_criteria": ["..."],
  "estimated_hours": 8
}
```
Each syllabus is saved as a row in the `syllabuses` table with the JSON arrays serialized as strings.

After all 11 levels, `initKnowledgeFiles` sets up the knowledge tracking structure for the course.

---

## Database Tables Involved

| Table | Purpose |
|---|---|
| `courses` | One row per course — title, topic, current_level |
| `syllabuses` | 11 rows per course — level content, learning objectives, subtopics |
| `tutor_instructions` | research brief, course outline, identity, pedagogy, rules |
| `chat_messages` | Per-level chat history |
| `notes` | Per-level user notes |
| `quiz_attempts` | Quiz and promotion test records |
| `quiz_questions` | Individual questions per attempt |
| `user_progress` | Knowledge gaps, score averages |

---

## The Error You Hit

```
ERR: Failed to parse syllabus JSON from model response.
Raw snippet: "{ "level": 0.5, "title": "Euclidean Geometry..."
```

This error comes from `curriculum.ts:272–275`. The JSON parse call throws, meaning the model returned something that wasn't valid JSON even after the code tried to:
1. Strip markdown code fences (` ```json `)
2. Extract the substring from first `{` to last `}`

**Most likely causes:**

- **Truncated response** — The model hit its output limit mid-JSON. The prompt is already asking for a lot (research context + outline context + prev syllabuses), and the JSON response for some levels can get long. The code caps `max_tokens` at `8096` for Anthropic but doesn't cap OpenAI/Ollama responses.
- **Model added prose around the JSON** — Some models ignore "Respond with ONLY the JSON" and add a sentence before or after. The brace-extraction heuristic usually catches this, but if the model puts a closing sentence *before* the final `}`, it fails.
- **Context window pressure** — At higher levels (3.0+), the prompt already includes 2–3x more context than early levels (research + outline + 3–6 prior syllabuses listed). Some smaller models start degrading under that load.

---

## Room to Innovate (Your Note)

A few directions worth considering:

1. **Structured output / JSON mode** — OpenAI and Anthropic both support `response_format: { type: "json_object" }`. Forcing JSON mode eliminates the parse failure class entirely. The LLM is constrained at the API level to return valid JSON.

2. **Retry with fallback parsing** — On parse failure, re-prompt the model with the raw broken response and ask it to fix and return only the JSON. One retry like this would silently recover most failures.

3. **Slimmer per-level prompts** — The prompt already includes up to 2,500 chars of outline + 2,000–3,000 of research + previous syllabus listings. A smarter approach would compress the "previously covered" section to just titles (no subtopic details) since that's all the deduplication logic needs.

4. **Streaming JSON assembly** — Currently `generateSyllabus` uses non-streaming `callLLM` but the research and outline steps stream. Adding stream support + a streaming JSON parser would let the UI show live syllabus construction and also detect truncation before it becomes a hard error.
