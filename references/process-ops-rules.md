# process-ops — AI rules (the one creative step)

You process operations that `recall` has already enriched with reference context.
**All mechanical work is done** — you do NOT search the index, read
`reference_materials/`, copy `sourceRange`, write HTML comments, or assemble
JSON. You only produce, per operation, a `result` text and an `annotationMeta`
object.

## Input

Read `operations/recall-context.json`. Each op already carries:

- `content`, `keywords`, `contentKeywords`, `filePath`, `line`
- `relevantRefs`: `[{ id, title, titleZh, authors, year, doi, citeKey, score, source, snippet }]`
  - `source`: `notes` (AI-distilled) | `fulltext` (keyword window) | `index-only`
  - `snippet`: the relevant excerpt — your primary factual anchor
- `localResolved`: whether at least one local ref yielded a snippet

> **Key principle**: `relevantRefs` snippets > general AI knowledge.
> If context is still insufficient, produce the best result and add a note to
> `warnings` (e.g. `"context insufficient: need fulltext of ref-012"`).

## Your output

For **each** op, append ONE line to `operations/results.ndjson`:

```json
{"id": "ai-op-000", "result": "...", "annotationMeta": {...}, "warnings": []}
```

- `result`: the produced text (see per-type rules). For `vv`, leave `""` to keep
  the original claim (assemble appends the status emoji); provide a corrected
  claim only for `incorrect`.
- `annotationMeta`: structured metadata — **assemble** formats the `<!-- -->`
  comment from this. Never write comment syntax yourself.
- `warnings`: optional array of issues. Omit or leave `[]` if none.

## annotationMeta schema

| type | annotationMeta | |
|------|----------------|---|
| `rr` | `{aspect}` | `"expression"` / `"clarity"` / … |
| `gg` | `{source}` | `"tanner2005 notes"` / `"no local ref, domain knowledge"` |
| `tt` | `{dir}` | `"zh→en"` (default) |
| `ee` | `{what}` | what was expanded, e.g. `"mechanism of extrudate swell"` |
| `cc` | `{}` | empty — condense is unconditional |
| `vv` | `{status, detail}` | status: `verified`/`incorrect`/`conflicting`/`notFound`/`needDownload` |
| `cite` | `{key?, doi?, status?}` | status omitted = local \| `"online"` \| `"notFound"` |

## Per-type rules

### `rr` — Rewrite
- Read `content` + context + `relevantRefs` snippets.
- If a ref contradicts a claim, flag in `warnings` and note it in `aspect`.
- Rewrite for improved academic English; keep the meaning.
- `result` = rewritten text; `annotationMeta = {aspect}`.

### `tt` — Translate
- `result` = academic-English translation; `annotationMeta = {dir: "zh→en"}`.

### `gg` — Generate
- Anchor on `relevantRefs` over general knowledge; cross-reference multiple
  papers when available.
- `result` = generated content (definitions, explanations, formulas in LaTeX);
  `annotationMeta = {source}`. If no local ref: `source = "no local ref, domain knowledge"`.

### `ee` — Expand
- Use `relevantRefs` for technically accurate depth; cite specific findings and
  suggest `[@citeKey]` where a paper is locally available.
- `result` = expanded text; `annotationMeta = {what}`.

### `cc` — Condense
- `result` = condensed text (no loss of key information); `annotationMeta = {}`.

### `vv` — Verify
- Check `relevantRefs` snippets first.
- If `localResolved === false` or local refs are insufficient → search online
  for **metadata only** via `mcsci-hub` (`search_papers`) or `crossref`
  (`crossref_search_works`). **Do NOT download PDFs** — mark `needDownload`.
- `result` = `""` (keep original) for `verified`/`conflicting`/`notFound`/
  `needDownload`; corrected text for `incorrect`.
- `annotationMeta = {status, detail}`:
  - `verified` → detail = `"ref-id or source"`
  - `incorrect` → detail = `"correction (source: ref-id)"`
  - `conflicting` → detail = `"conflict description"`
  - `notFound` → detail = `"search terms tried"`
  - `needDownload` → detail = `"doi or title"`

### `cite` — Insert Citation
- Check `relevantRefs` first — each carries `citeKey` + `doi`.
- If `localResolved === false` or no local paper fits → search online; set
  `status: "online"` with a `key` + `doi`, or `status: "notFound"`.
- `result` = `[@key]` (or leave `""` — assemble builds `[@key]` from `key`).
- `annotationMeta`:
  - local: `{key, doi}`
  - online: `{key, doi, status: "online"}`
  - not found: `{status: "notFound"}`

## After processing all ops

Tell the user to run:
```
node .agents/skills/academic-markup/scripts/enforce-markup.mjs assemble
node .agents/skills/academic-markup/scripts/enforce-markup.mjs report              # stats before integrate clears completed-ops.json
node .agents/skills/academic-markup/scripts/enforce-markup.mjs integrate --dry-run  # preview
node .agents/skills/academic-markup/scripts/enforce-markup.mjs integrate            # apply
```

## Rules recap

- `reference_materials` > general AI knowledge.
- Semantic Scholar rate limits: **no parallel calls**, `sleep` ≥ 3 s (≥ 5 s for
  `search_authors`); prefer `mcsci-hub` or `crossref`.
- Never download PDFs (user handles manually); mark `needDownload`.
- **Do NOT** write HTML comments, copy `sourceRange`, or hand-assemble
  `completed-ops.json` — `assemble` does all of that from your `results.ndjson`.
