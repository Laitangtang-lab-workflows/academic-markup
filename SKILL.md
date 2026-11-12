---
name: academic-markup
description: Process academic-writing markup markers in Markdown manuscripts — generate (gg), rewrite (rr), translate Chinese→English (tt), fact-check (vv), expand (ee), condense (cc), and insert citations ([['']]), then number the citations and build the reference list (refs). Auto-detects every .md manuscript in the project root and 手稿/ subdirectory that contains valid markers and runs an extract→recall→process→assemble→report→integrate→refs pipeline, recalling snippets from the local reference_materials/ library. Markers inside code blocks/inline code never count. Invoke via /academic-markup to run the whole pipeline end-to-end (dry-run preview + confirmation before writing back). Use when a .md manuscript contains markers like gg'..'gg / rr'..'rr / vv'..'vv / [['']], or the user asks to process/resolve/run/处理 the manuscript markup/标记, or to number citations / 生成参考文献列表.
---

# academic-markup — AI-assisted academic writing pipeline

A markup-driven writing pipeline. The user embeds lightweight markers in a
Markdown manuscript; this skill resolves them — generating text, rewriting,
translating, fact-checking against the local reference library, expanding, or
inserting citations — and writes the results back with traceable HTML-comment
annotations.

**`/academic-markup` is the single entry point.** It runs the whole pipeline by
default (or a single step if you ask). No other slash commands are needed.

## When to use

- A `.md` file in the project root contains markers: `gg'..'gg`, `rr'..'rr`,
  `tt'..'tt`, `vv'..'vv`, `ee'..'ee`, `cc'..'cc`, or atomic `[['']]` / `[??]` /
  `[fig: ...]`.
- The user asks to "处理标记 / 跑管线 / process the markers / run the pipeline /
  resolve the markup" in a manuscript.

## Prerequisites (hard gate)

- A `reference_materials/` directory must exist **at the project root or any
  ancestor directory** (scripts walk up from cwd to find it — a library shared
  one level above the manuscript project works). This skill **only reads** it
  (it never creates it). If absent, the pipeline hard-stops at preflight and
  asks the user to add it. Building that library is the job of the note-gen skill.
- After the dual-zone reorg, `reference_materials/` holds two zones —
  `期刊文献/` (journal papers) and `长篇文献/` (books/theses). **academic-markup
  recalls snippets from `期刊文献/` only** (its `_index.json` + notes/fulltext);
  `长篇文献/` is excluded from manuscript snippet recall.
- Markers use the **single-quote** syntax (`gg'..'gg`). Double-quote `gg''..''gg`
  is invalid.

## Run the full pipeline — what `/academic-markup` does by default

You run the **complete** pipeline in one go. You orchestrate the mechanical
steps via Bash, and you perform the single creative step (process-ops) yourself.
The only step that modifies manuscripts is the final `integrate`, which is gated
behind a dry-run preview + your explicit confirmation.

### 0. Preflight — reference library check
```bash
d="${MARKUP_ROOT:-$PWD}"; while [ "$d" != "/" ] && [ ! -d "$d/reference_materials" ]; do d=$(dirname "$d"); done; [ -d "$d/reference_materials" ] || { echo "ERROR: reference_materials/ not found (walked up from cwd). 本 skill 只读取该目录、不负责创建。请先添加（其内容由 note-gen skill 产出）。"; exit 1; }
```
If it exits non-zero: **STOP**. Tell the user the reference library is missing
and must be added before the pipeline can run.

### 1. Extract
```bash
node .agents/skills/academic-markup/scripts/enforce-markup.mjs extract
```
- If output says **"No manuscripts with AI-dependent markers found"**: STOP.
  Suggest `... enforce-markup.mjs scan` so the user sees what's wrong (likely
  wrong quote syntax).
- Otherwise report ops / manuscript count and continue.

### 2. Recall
```bash
node .agents/skills/academic-markup/scripts/enforce-markup.mjs recall
```
Report the ref-attachment summary (refs attached, locally resolved count).
(Hard-stops if no `reference_materials/`.)

### 3. Process ops — YOUR creative step
1. Read `operations/recall-context.json`.
2. **Read `.agents/skills/academic-markup/references/process-ops-rules.md`** and
   follow it exactly: the `annotationMeta` schema table; the per-type rules
   (`rr` / `tt` / `gg` / `ee` / `cc` / `vv` / `cite`); the Rules recap
   (reference_materials > general knowledge; no parallel S2 calls with
   `sleep` ≥ 3 s; never download PDFs — mark `needDownload`).
3. For **each** op, produce one NDJSON line:
   `{"id": "...", "result": "...", "annotationMeta": {...}, "warnings": []}`
4. **Overwrite `operations/results.ndjson`** with exactly one line per op.
5. Do NOT write HTML comments, copy `sourceRange`, or hand-assemble
   `completed-ops.json` — `assemble` does all of that from your `results.ndjson`.

> Key principle: `relevantRefs` snippets > general AI knowledge. If context is
> insufficient, still produce the best result and add a note to `warnings`.

### 4. Assemble
```bash
node .agents/skills/academic-markup/scripts/enforce-markup.mjs assemble
```

### 5. Report
```bash
node .agents/skills/academic-markup/scripts/enforce-markup.mjs report
```
Show the user the summary (ops processed, warnings, citations, unresolved refs).

### 6. Preview (dry-run)
```bash
node .agents/skills/academic-markup/scripts/enforce-markup.mjs integrate --dry-run
```
Show the user the preview of what would be written back to each manuscript.

### 7. Confirm & integrate
Use **AskUserQuestion** to ask whether to apply:
- "Apply to manuscript(s)" — run
  `node .agents/skills/academic-markup/scripts/enforce-markup.mjs integrate`,
  then confirm completion (integrate clears `completed-ops.json`).
- "Stop here (keep preview only)" — tell the user the pipeline paused before
  writing; they can run `integrate` manually later.

### 8. Build references — citation numbering (only after step 7 applied)
Run after a successful integrate (if the user stopped at step 7, skip this step —
the manuscripts still hold their original markers):
```bash
node .agents/skills/academic-markup/scripts/enforce-markup.mjs refs --dry-run
```
- If it reports **"No manuscripts with citation markers found"**: nothing to
  number — the pipeline is DONE.
- Otherwise show the preview (resolved/unresolved DOIs, the generated reference
  list), then use **AskUserQuestion**:
  - "Apply reference numbering" — run
    `node .agents/skills/academic-markup/scripts/enforce-markup.mjs refs`
    (writes back, creates `*.md.bak`).
  - "Skip numbering" — keep the `[@citekey]<!-- cite -->` markers as-is; `refs`
    can be run manually later.
- Unresolved markers (DOI not yet in `reference/` or `_index.json`) stay in
  place untouched — once the library grows, re-running `refs` picks them up.
- `refs` exits 0 even with unresolved DOIs: that is a "library incomplete"
  state, not an error.

### Error handling
If any Bash step exits non-zero, **STOP** and report the failing command + its
output. Do not continue.

### Notes
- Steps 0–6 only write to `operations/` — fully reversible. Only step 7
  `integrate` touches manuscripts (a `.md.bak` backup is created per source file).
- After a successful integrate, `operations/` pipeline files are cleared (except
  `results.ndjson`); this is expected.

## Single-step use — when the user wants one step, not the whole pipeline

Script entry: `node .agents/skills/academic-markup/scripts/enforce-markup.mjs <subcommand> [options]`

| Subcommand | Purpose |
|------------|---------|
| `scan` | Scan manuscript(s) for markers |
| `validate` | Validate marker syntax |
| `extract` | Extract AI ops → `operations/pending-ops.json` (auto-detects all manuscripts) |
| `recall` | Recall local refs → `operations/recall-context.json` (hard-stops if no `reference_materials/`) |
| `assemble` | Assemble `operations/completed-ops.json` (annotation format) |
| `integrate` | Write results back into each manuscript (creates `*.md.bak`) |
| `report` | Report results / warnings / citations / unresolved |
| `refs` | Number citation markers → `[N]<!-- ref -->` + `reference` list (resolves DOIs via `reference/*.enw|.ris` + `期刊文献/_index.json`; idempotent; creates `*.md.bak`) |
| `status` | Show current pipeline status + project root |

Options: `--file <path>` (target one manuscript), `--root <dir>`, `--verbose`,
`--dry-run` (for integrate: preview without writing).

For the standalone process-ops step (read `recall-context.json` → write
`results.ndjson`), follow step 3 above + `references/process-ops-rules.md`.

Full step/file reference (operations/ layout, reversibility, multi-manuscript
internals, project-root resolution): `references/pipeline-workflow.md`.

## Marker cheat-sheet (full spec in `references/markup-dictionary.md`)

| Marker | Action | Example |
|--------|--------|---------|
| `gg'hint'gg` | Generate content from hint + refs | `gg'formula and meaning'gg` |
| `rr'text'rr` | Rewrite for academic English | `rr'The ink flows fast.'rr` |
| `tt'中文'tt` | Translate Chinese → English | `tt'浆料的流变特性...'tt` |
| `vv'claim'vv` | Fact-check against refs | `vv'PTT proposed in 1977.'vv` |
| `ee'point'ee` | Expand with depth | `ee'extrudate swell'ee` |
| `cc'text'cc` | Condense | `cc'wordy passage'cc` |
| `[['']]` / `[['ref-002']]` / `[['doi:…']]` | Insert citation (optionally name the target: ref id, DOI, or hint) | `…well-documented. [['']]` / `…four-stage process. [['ref-002']]` |
| `[??]` / `[??: hint]` | Missing-info placeholder | `[??: element count]` |
| `[fig: desc]` | Figure placeholder | `[fig: swell geometry]` |

## Multi-manuscript & auto-detection scope

`extract` auto-detects every `.md` with valid markers in the **flat project
root plus the `手稿/` subdirectory (recursive)**. Config docs are excluded
(`AGENTS.md`, `CLAUDE.md`, `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`,
`LICENSE` — case-insensitive basename) alongside hidden/temp/`.bak` files;
`--file` overrides and may point anywhere. All ops share one `operations/`
dir with globally-unique IDs; `integrate` writes each result back to its own
source file, so several manuscripts can be drafted in parallel and processed
in one pass.

**Code-region immunity**: markers inside inline code (`` `gg'..'gg` ``) or
fenced code blocks never count — detection, extraction, validation and `refs`
all run on a code-stripped copy (equal-length space masking, offset- and
line-preserving, so write-back positions stay exact). Documentation files
showing markup examples are therefore safe, and AI context snippets carry no
code-block text.

## Citation lifecycle — from `[['']]` to the reference list

```
[['']] ──(cite op, steps 3+6)──► [@citekey]<!-- cite: ... doi:... -->
       ──(refs, step 8)───────► [N]<!-- ref: doi:... source:... --> + ```reference 块
```

`refs` scans three marker shapes: unresolved `[@citekey]<!-- cite -->` (the cite
op's output), already-numbered `[N]<!-- ref -->` (re-numbered idempotently on
every run), and manual `[10.xxx/yyy]` DOIs (never inside HTML comments). DOIs
resolve against `reference/*.enw|.ris` (complete metadata, preferred) with
`reference_materials/期刊文献/_index.json` as fallback (partial metadata). Every
run regenerates numbering and the `reference` block from scratch; unresolved
markers stay put and resolve on a later re-run once the library grows. Design
history: `references/build-references-design.md`.

## Portability / reuse

Self-contained under `.agents/skills/academic-markup/`. **Copy just this folder**
into another project's `.agents/skills/` and it works immediately —
`/academic-markup` is auto-registered from the folder name, no command files to
install, no `settings.json` changes, no path edits (scripts resolve the project
root from cwd).
