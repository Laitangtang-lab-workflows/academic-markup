# Markup Dictionary

The marker language users embed in Markdown manuscripts. Markers use
**single-quote** delimiters (two-letter prefix + `'`). The pipeline extracts
them, the AI resolves them, and `integrate` writes the result back with an
HTML-comment annotation.

> Marker prefixes are doubled letters (`gg`, `rr`, …) so they are easy to
> text-search and unambiguous. Quotes are always ASCII single quotes `'`.

## Writing markers (user side)

### 1. `gg'hint'gg` — Generate
AI generates academic content at the marker, guided by `hint` and the local
reference library.
```
The Reynolds number is defined as gg'include the formula and physical meaning'gg.
```
Annotation: `<!-- gen: generated from {source} -->`

### 2. `rr'text'rr` — Rewrite
Rewrite `text` for better academic English; keep the meaning.
```
rr'The ink flows fast. It is very important for printing.'rr
```
Annotation: `<!-- rw: improved {aspect} -->`

### 3. `tt'中文'tt` — Translate
Translate a Chinese passage into academic English. Default direction `zh→en`;
reverse with `tt'en>zh:...'tt`.
```
tt'浆料的流变特性对挤出形貌有显著影响。'tt
```
Annotation: `<!-- tt: zh→en -->`

### 4. `vv'claim'vv` — Verify (fact-check)
Check a factual claim against the local reference library first, then online.
```
vv'The PTT model was first proposed by Phan-Thien and Tanner in 1977.'vv
```
Result emoji is appended inline + an annotation:
| Result | Marker | Meaning |
|--------|--------|---------|
| Correct | `✅` | refs support the claim |
| Wrong | `❌[correction]` | refs contradict; give correction |
| Conflicting | `⚠️[reason]` | evidence is contradictory/insufficient |
| Not found | `∅[search terms]` | no relevant ref found |
| Need download | `📥[DOI/title]` | relevant ref found, full text unavailable |
Annotation: `<!-- vv: ✅ — verified via doi:10.… -->` (status-dependent)

### 5. `ee'point'ee` — Expand
Deepen `point` with detail, mechanism, citations from refs.
```
ee'extrudate swell phenomenon'ee
```
Annotation: `<!-- ee: expanded from {what} -->`

### 6. `cc'text'cc` — Condense
Tighten `text` without losing key information.
```
cc'a wordy, redundant passage'cc
```
Annotation: `<!-- cc: condensed -->`

### 7. `[['']]` or `[['target']]` — Insert citation
Insert the best-matching reference citation at this point. Optionally name the
target inline — a library ref id (`ref-002`), a DOI (`doi:10.xxx/yyy`), or a
short free-text hint; recall then looks the designated reference up directly
and the marker outranks keyword matching.
```
Extrudate swell is well-documented in viscoelastic flows. [['']]
…as a four-stage process. [['ref-002']] [['doi:10.1115/1.2960953]]
```
Hint must not contain `'`, `\` or `]`. Unresolved hinted markers are written
back as `[['target']]` (not blanked) so a later re-run picks them up once the
library grows.
Annotation: `<!-- cite: @key -> doi:10.… -->` (or `no ref found (hint: …)`)

## Information placeholders

### 8. `[??]` or `[??: hint]` — Missing info
Flag a spot needing data/formula/figure. The AI should state what's missing.
```
The mesh consisted of [??: number of elements] elements.
```

### 9. `[fig: description]` — Figure placeholder
Mark where a figure should go.
```
[fig: extrudate swell geometry at capillary exit]
```

## Annotation format (output side)

After processing, an HTML comment is appended at the marker's location. It does
not affect rendering. Examples:
```markdown
<!-- rw: improved academic expression -->
<!-- gen: generated from tanner2005 notes -->
<!-- tt: zh→en -->
<!-- ee: expanded mechanism of extrudate swell -->
<!-- cc: condensed -->
<!-- vv: ✅ — verified via doi:10.1122/1.549599 -->
<!-- vv: ❌ — corrected: Phan-Thien & Tanner (1975) -->
<!-- vv: ⚠️ — conflicting evidence between @bird1987 and @tanner1970 -->
<!-- vv: ∅ — searched "PTT extrudate swell experiment", no relevant ref -->
<!-- vv: 📥 — download needed: 10.1016/j.jnnfm.2004.02.005 -->
<!-- cite: @newKey -> doi:10.1017/jfm.2023.456 -->
```

## Citation format

- Pandoc-style: `[@key]` or `[@key1; @key2]`.
- The AI never hand-writes annotation syntax — `assemble` builds it from
  `annotationMeta`. See `process-ops-rules.md`.
