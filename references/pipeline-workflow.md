# Pipeline Workflow

The eight-step pipeline that turns manuscript markers into resolved text. Steps
1–5 write to `operations/` only (fully reversible); `integrate` and `refs` touch
the manuscripts (each with a `.md.bak` backup).

## Steps

```
1. extract → 2. recall → 3. process-ops (AI) → 4. assemble → 5. report → 6. integrate → 8. refs
                                                    (7 = user confirmation gate before 6)
```

| # | Step | Who | Reads | Writes | Notes |
|---|------|-----|-------|--------|-------|
| 0 | **preflight** | script | `reference_materials/` | — | `/academic-markup` checks the library exists; hard-stop if missing |
| 1 | **extract** | script | all manuscripts in project root | `operations/pending-ops.json` | multi-manuscript; global op IDs |
| 2 | **recall** | script | pending-ops + reference_materials index/notes/fulltext | `operations/recall-context.json` | hard-stops if no `reference_materials/` |
| 3 | **process-ops** | **AI** | recall-context.json | `operations/results.ndjson` | the only creative step — see `process-ops-rules.md` |
| 4 | **assemble** | script | pending-ops + results.ndjson | `operations/completed-ops.json` | wires annotations from annotationMeta |
| 5 | **report** | script | completed-ops + pending + recall | (stdout) | stats before integrate |
| 6 | **integrate** | script | completed-ops.json | each manuscript (+ `*.md.bak`) | per-file; `--dry-run` to preview; clears completed-ops |
| 8 | **refs** | script | manuscripts + `reference/*.enw|.ris` + `期刊文献/_index.json` | each manuscript (+ `*.md.bak`) | citation numbering + `reference` block; runs only after integrate applied |

## Step 8 — refs (citation numbering)

After `integrate` writes `[@citekey]<!-- cite: ... doi:... -->` markers into the
manuscript, `refs` converts them into numbered citations and builds the
reference list:

- Scans three shapes: `[@citekey]<!-- cite -->` (unresolved), `[N]<!-- ref -->`
  (previous run — re-numbered idempotently), `[10.xxx/yyy]` (manual DOI, never
  inside HTML comments).
- Resolution priority: `reference/*.enw|.ris` (complete metadata) →
  `reference_materials/期刊文献/_index.json` (partial). Numbers are assigned by
  first appearance; the ```reference block at the end of the file is fully
  regenerated every run.
- Unresolved DOIs keep their markers; they resolve on a later re-run once the
  library grows. Unresolved DOIs do **not** produce a non-zero exit code.
- Direct write to manuscripts (no `operations/` intermediate): `.md.bak` backup
  first, `--dry-run` previews, `--file` targets one manuscript.
- Design history and decision log: `build-references-design.md`.

## Pipeline files (`operations/`)

| File | Purpose | Produced by |
|------|---------|-------------|
| `pending-ops.json` | queued ops extracted from manuscripts | extract |
| `recall-context.json` | per-op reference snippets (AI input) | recall |
| `results.ndjson` | AI output, one JSON line per op | process-ops (AI) |
| `completed-ops.json` | assembled results (integrate input) | assemble |
| `*.md.bak` | manuscript backup before integrate | integrate |

## Multi-manuscript behavior

- **extract** scans the flat project root **plus the `手稿/` subdirectory
  (recursive)**, finds every `.md` with valid markers, and merges all ops into
  a single `pending-ops.json` with **globally-unique IDs** (`ai-op-000`…).
  Each op carries its source `filePath`.
- Excluded from auto-detection: config docs (`AGENTS.md`, `CLAUDE.md`,
  `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `LICENSE` — case-insensitive)
  + hidden/`~`/`.bak`. `--file` bypasses exclusion and accepts any path.
- **Code-region immunity**: parsing/detection runs on a code-stripped copy of
  each file (inline code + fenced blocks masked by equal-length spaces), so
  markup examples in documentation never count as markers. Masking is
  offset-preserving: positions and line numbers computed on the stripped text
  apply to the original unchanged, and `integrate` writes back to the original.
- **recall / process-ops / assemble** are op-centric, so they handle mixed-source
  ops transparently.
- **integrate** groups completed results by `filePath` and writes each
  manuscript separately (each gets its own `.md.bak`). So multiple manuscripts
  can be processed in one pass.
- Use `--file <path>` on extract/integrate to limit to a single manuscript.

## reference_materials hard-stop

This skill **only reads** `reference_materials/`; it never creates it. After
the dual-zone reorg it specifically recalls from the **`期刊文献/` zone** (its
`_index.json` + notes/fulltext); `长篇文献/` is excluded from snippet recall. If
the journal zone is missing:
- `recall` returns an error and exits non-zero (`pending-ops.json` is preserved
  so the user can resume after adding the library).
- `/academic-markup` aborts at the Step-0 preflight, before any work.

Building the library (PDFs → notes/fulltext → `_index.json`) is the job of a
separate note-generation skill (note-gen).

## Reversibility

- Steps 1–5 only write to `operations/`. Discardable.
- Step 6 `integrate` and step 8 `refs` edit manuscripts directly; each creates
  `<manuscript>.md.bak` first. `--dry-run` previews the diff without writing.
- After a successful integrate, `completed-ops.json` is cleared (expected).

## Project root resolution

Scripts resolve the project root from the current working directory
(`process.cwd()`), or `--root <dir>` / `MARKUP_ROOT` env override. The skill's
own install location is irrelevant — copy the folder anywhere and it operates on
the project you run it from.
