# Reference-management script design (archived)

> Archive note: this design has been implemented and **merged into the academic-markup skill** as the 8th subcommand `refs` of `enforce-markup.mjs` (step 8 of the full pipeline). Three adaptations at merge time: the project root is now resolved by `lib/paths.mjs` (fixing the original script's install-location-based resolution, which broke after directory moves); manuscript-exclusion rules were aligned with `enforce-markup.mjs`; and unresolved citations no longer set a non-zero exit code (a "library incomplete" state, not an error — so the `/academic-markup` full pipeline is never interrupted). The former standalone script `工具脚本\build-references\` has been removed. This document keeps the original design and implementation record; paths inside are snapshots of that time.

> Status: implemented | designed 2026-07-20 | implemented 2026-07-21

---

## 1. Goal

Write a standalone script `.agents/scripts/build-references/build-references.mjs` that scans Markdown manuscripts for citation markers `[@citekey]<!-- cite:...-->`, looks each one up in `reference_materials/期刊文献/_index.json`, replaces in-text citations with numbers `[N]`, and generates a numbered reference list at the end of the document.

Every run **scans from scratch and fully regenerates**, so citations unresolved today resolve automatically once the library grows.

---

## 2. Data flow

```
manuscript.md
  │
  ├─ scan two patterns:
  │   A. [@citekey]<!-- cite: ... doi:10.xxx/yyy ... -->   (unresolved citation inserted by academic-markup)
  │   B. [N]<!-- ref: doi:10.xxx/yyy -->                   (citation resolved by a previous run)
  │
  ├─ extract DOI → look up reference_materials/期刊文献/_index.json
  │
  ├─ DOI matched → assign number [1], [2], [3]... → replace marker → append to reference list
  │
  ├─ DOI not matched → leave the marker untouched (auto-resolves on the next scan once the user adds the paper)
  │
  └─ generate/overwrite the ```reference fenced block at the end
```

---

## 3. _index.json information sufficiency

### Fields carried per paper

| Field | Example | Usable for citation |
|------|------|:--:|
| `authors` | `["Arit Das", "Eric L. Gilmer", "Saeid Biria", "Michael J. Bortner"]` | ✅ |
| `title_en` | `"Importance of Polymer Rheology on Material Extrusion..."` | ✅ |
| `year` | `2021` | ✅ |
| `venue` | `"ACS Applied Polymer Materials"` | ✅ |
| `doi` | `"10.1021/acsapm.0c01228"` | ✅ |
| `volume` | — | ❌ |
| `number`/`issue` | — | ❌ |
| `pages` | — | ❌ |

### Conclusion

The five core fields are complete and produce a well-formed academic citation. Missing volume/issue/pages does not block basic citation; if `_index.json` gains those fields later, only the formatting logic needs a tweak — a seamless upgrade.

---

## 4. File layout

```
<project root>/
├── scripts/
│   └── build-references.mjs    ← the new script
├── reference_materials/
│   └── 期刊文献/
│       └── _index.json          ← read-only (journal zone; the script never writes it. Index lives here after the dual-zone reorg)
└── *.md                         ← manuscripts (read+write: replace citation markers + overwrite the reference block)
```

The script is fully decoupled from `.agents/skills/academic-markup/` and imports none of its modules.

---

## 5. Script design

### 5.1 Technology choices

- **Runtime**: Node.js ESM (`.mjs`)
- **Dependencies**: zero external — Node.js built-in `fs` and `path` only
- **Style**: matches the existing academic-markup scripts (`#!/usr/bin/env node`, custom CLI arg parsing, `--verbose`/`--dry-run` flags)

### 5.2 CLI usage

```bash
# auto-detect every .md manuscript under the project root with citation markers
node scripts/build-references.mjs

# target one file
node scripts/build-references.mjs --file "manuscript.md"

# preview mode (print the replacement mapping and reference list; touch nothing)
node scripts/build-references.mjs --dry-run

# verbose
node scripts/build-references.mjs --verbose
```

### 5.3 Core logic (pseudocode)

```
function buildReferences(manuscriptPath):

  // ── step 1: read ──
  manuscript = readFile(manuscriptPath)
  index = readJSON('reference_materials/期刊文献/_index.json')

  // ── step 2: scan citation markers ──
  citations = []

  // pattern A: unresolved citations (from academic-markup)
  for match in manuscript.matchAll(/\[@([^\]]+)\]<!--\s*cite:.*?doi:(10\.\d{4,9}\/[^\s)]+)/g):
    citations.push({ citekey: match[1], doi: match[2], resolved: false })

  // pattern B: resolved citations (previous run's output; used for regeneration)
  for match in manuscript.matchAll(/\[(\d+)\]<!--\s*ref:\s*doi:(10\.\d{4,9}\/[^\s)]+)\s*-->/g):
    citations.push({ number: match[1], doi: match[2], resolved: true })

  // ── step 3: dedupe DOIs + look up _index.json ──
  uniqueDois = [...new Set(citations.map(c => c.doi))]
  doiToRef = {}

  for (doi of uniqueDois):
    entry = index.entries.find(e => e.doi === doi)
    if entry:
      doiToRef[doi] = entry   // matched
    // else: absent from the map → marker kept as-is below

  // ── step 4: assign numbers by first occurrence ──
  number = 1
  doiToNumber = {}
  orderedRefs = []

  for (doi of uniqueDois):
    if doiToRef[doi]:
      doiToNumber[doi] = number
      orderedRefs.push({ number, entry: doiToRef[doi] })
      number++

  // ── step 5: replace every in-text citation ──
  newManuscript = manuscript

  // replace unresolved citations (pattern A)
  newManuscript = newManuscript.replaceAll(
    /\[@[^\]]+\]<!--\s*cite:.*?doi:(10\.\d{4,9}\/[^\s)]+).*?-->/g,
    (match, doi) => {
      if doiToNumber[doi]:
        return `[${doiToNumber[doi]}]<!-- ref: doi:${doi} -->`
      else:
        return match   // not in _index.json; keep as-is
    }
  )

  // replace resolved citations (pattern B) — renumber
  newManuscript = newManuscript.replaceAll(
    /\[\d+\]<!--\s*ref:\s*doi:(10\.\d{4,9}\/[^\s)]+)\s*-->/g,
    (match, doi) => {
      if doiToNumber[doi]:
        return `[${doiToNumber[doi]}]<!-- ref: doi:${doi} -->`
      else:
        return match
    }
  )

  // ── step 6: build the reference list ──
  refBlock = '```reference\n'
  for ref of orderedRefs:
    refBlock += formatReference(ref.number, ref.entry) + '\n'
  refBlock += '```'

  // ── step 7: overwrite the trailing reference block ──
  if newManuscript contains '```reference':
    newManuscript = replaceExistingRefBlock(newManuscript, refBlock)
  else:
    newManuscript = newManuscript + '\n\n' + refBlock

  // ── step 8: back up + write back ──
  writeFile(manuscriptPath + '.bak', manuscript)   // backup of the original
  writeFile(manuscriptPath, newManuscript)
```

---

## 6. Citation format

### 6.1 Single-entry format

```
[N] Author1, Author2, ..., AuthorN (Year). Title. *Journal*. doi:xxx
```

**Example**:
```
[1] Arit Das, Eric L. Gilmer, Saeid Biria, Michael J. Bortner (2021). Importance of Polymer Rheology on Material Extrusion Additive Manufacturing: Correlating Process Physics to Print Properties. *ACS Applied Polymer Materials*. doi:10.1021/acsapm.0c01228
```

### 6.2 Author name format (to be confirmed)

| Option | Example | Note |
|------|------|------|
| **Full names** | `Arit Das, Eric L. Gilmer` | raw data from _index.json; simple but not journal convention |
| **Initials** | `A. Das, E. L. Gilmer` | needs surname/given-name parsing; closer to journal style |

> ⚠️ **Open**: confirm which format before implementation.

### 6.3 Truncation for many authors

- ≤10 authors: list all
- >10 authors: first 3 + `et al.`
- (no >10-author cases in _index.json yet)

---

## 7. Edge cases

| Case | Behavior |
|------|------|
| Same paper cited multiple times | same number assigned; every occurrence replaced with the same `[N]` |
| DOI not in _index.json | the `[@key]<!-- cite:...-->` marker stays untouched |
| No citation resolves at all | no ```reference block generated; the manuscript is not modified |
| Manuscript has no citation markers | prints "No citations found."; touches nothing |
| `_index.json` missing | error exit: `Error: reference_materials/期刊文献/_index.json not found` |
| ```reference block already present | replaced wholesale (fence markers kept) |
| ```reference block absent | appended at the end |
| Write-back fails | `.bak` backup retained; the user is told to restore manually |

---

## 8. Relationship to the academic-markup skill

```
academic-markup (skill)              build-references (this script)
─────────────────────                ──────────────────────────
[['']]  →  [@citekey]<!-- cite -->   →  [N]<!-- ref: doi --> + reference list
           (semantic insertion:          (numbering + formatted
            find the best-matching        reference list)
            paper)
```

| | academic-markup | build-references |
|---|---|---|
| Responsible for | semantic insertion (find the best-matching paper) | formatted output (numbering, dedup, list generation) |
| Input | `[['']]` markers in the manuscript | `[@citekey]<!-- cite -->` markers in the manuscript |
| Output | `[@citekey]<!-- cite:...-->` | `[N]<!-- ref: doi -->` + ```reference |
| Depends on | .bib / .md under reference_materials/ | reference_materials/期刊文献/_index.json |
| Standalone runnable | ✅ | ✅ |

### Recommended workflow

```
1. Write [['']] markers in the manuscript
2. /academic-markup        → markers resolved, [@citekey]<!-- cite:...--> inserted
3. New papers enter via /note-gen (PDFs into the synced PDF library; metadata and index in reference_materials/)
4. node scripts/build-references.mjs  → numbering + reference list
5. Repeat 1–4 until every citation resolves
```

---

## 9. Regular expressions

### Pattern A: unresolved citations

```
\[@([^\]]+)\]          matches [@citekey]
<!--\s*cite:           followed by <!-- cite:
.*?                    (lazy) anything
doi:                   doi:
(10\.\d{4,9}/[^\s)]+)  capture the DOI: 10.xxxx/... (no whitespace or ))
.*?-->                 up to -->
```

JavaScript needs the `g` flag for global matching since `<!-- -->` spans multiple characters.

### Pattern B: resolved citations

```
\[(\d+)\]              matches [number]
<!--\s*ref:\s*doi:     followed by <!-- ref: doi:
(10\.\d{4,9}/[^\s)]+)  capture the DOI
\s*-->                 up to -->
```

### Overwriting the reference block

```
Match and replace the entire ```reference ... ``` block:
/```reference\n[\s\S]*?```/g
```

---

## 10. Verification plan

### 10.1 Functional tests

```bash
# 1. preview mode (no writes)
node scripts/build-references.mjs --dry-run --verbose

# 2. real run
node scripts/build-references.mjs

# 3. diff against the backup: only citation markers and the reference block may differ
diff manuscript.md.bak manuscript.md

# 4. run again; confirm idempotence
node scripts/build-references.mjs
diff manuscript.md.bak manuscript.md   # identical to step 3's result

# 5. manually add a previously missing DOI to _index.json; run again
#    confirm the previously skipped citation is now numbered and listed
```

### 10.2 Edge tests

| Scenario | Expected |
|----------|----------|
| Manuscript without citation markers | "No citations found"; file untouched |
| _index.json deleted | error exit |
| No citation DOI present in _index.json | no marker touched; no reference block |
| Same DOI cited 3 times | all 3 replaced with the same `[N]`; one list entry |
| Reference block already present | contents fully replaced |
| Mixed resolved/unresolved citations | everything rescanned and renumbered |

---

## 11. Open questions

1. **Author name format**: full names (`Arit Das`) or initials (`A. Das`)?
2. **`vv` fact-check markers referencing ref-XXX** (e.g. `ref-029, ref-008, ref-031`): should they feed the reference list too? The current design handles only `[@citekey]`.
3. **Script location**: is `.agents/scripts/build-references/build-references.mjs` right, or somewhere else?

---

## 12. Possible future extensions

- Read `.bib` files directly as a data source (not only `_index.json`)
- Multiple citation styles (APA, MLA, Chicago, …)
- Auto-update `_index.json` (fetch metadata online for DOIs, filling gaps)
- Citation statistics (resolved/unresolved counts, missing-paper list)

---

## 13. Implementation record (2026-07-21)

### File layout

```
work-A/
├── .agents/scripts/build-references/
│   ├── build-references.mjs          ← CLI entry + orchestration (~350 lines)
│   └── lib/
│       ├── parse-reference-files.mjs  ← ENW/RIS parsers (~220 lines)
│       └── format-reference.mjs       ← author/journal/citation formatting (~260 lines)
```

### Differences from the original design

| Item | Original design | As implemented |
|------|----------|----------|
| Citation format | custom format | **Additive Manufacturing journal style** (author initials + ISO 4 journal abbreviations) |
| Data source | `_index.json` only | **reference/ ENW/RIS preferred**, `_index.json` as fallback |
| Scan patterns | 2 (A+B) | **3** (A+B+C; adds the manual `[DOI]` form) |
| Multi-manuscript | unspecified | **auto-detection**, exclusion rules aligned with academic-markup |
| Citation marker completeness | none | `source:enw|ris|index` inside the `<!-- ref: ... -->` marker |
| Journal abbreviations | out of scope | ISO 4 rule word list (~83% coverage of the current 24 journals) |
| File count | single file suggested | **multiple modules** (reusable, testable) |

### Confirmed design decisions

- **Author format**: Initials. LastName (`H. Yuk`, `R.I. Tanner`)
- **Manual citations**: `[10.xxx/yyy]` bare DOI
- **Citation block position**: appended at the end
- **Abbreviation misses**: keep the original word + a `--verbose` warning
- **Full independence**: zero imports from academic-markup modules
- **vv ref-XXX**: not fed into the reference list
