# academic-markup

**Inline markup markers for AI-assisted academic writing: generate, rewrite, translate, fact-check, expand, condense and cite — a full extract→recall→process→assemble→report→integrate pipeline with a local reference library in the loop.**

> [!NOTE]
> This repository is **written and maintained entirely by AI agents** under human direction — see [AI-maintained](#ai-maintained).
> Documentation is English-first; a Chinese README is available ([README.zh-CN.md](README.zh-CN.md)).

## Why

Writing a manuscript with an AI in the loop needs a contract between the human author and the model: the author marks *what* should happen to a passage, the AI decides *how*, and the result lands back in the file with a traceable annotation. This skill is that contract, distilled from months of real manuscript work:

- **Lightweight inline markers** — `gg'hint'gg` (generate), `rr'text'rr` (rewrite for academic English), `tt'中文'tt` (translate), `vv'claim'vv` (fact-check against the local library), `ee'..'ee` (expand), `cc'..'cc` (condense), `[['']]` (insert citation), `[??]` / `[fig: ...]` placeholders.
- **A nine-step pipeline** (`/academic-markup` is the single entry point): preflight library check → extract → recall → process (the AI's creative step, governed by a strict rules doc) → assemble → report → dry-run preview → confirmed write-back → citation numbering + reference list. Every step before the confirmed write-back only touches `operations/` — fully reversible.
- **Local-library grounding**: recall pulls snippets from the project's `reference_materials/` journal zone, so results lean on your curated library rather than generic model knowledge.
- **Citation lifecycle**: `[['']]` → `[@citekey]<!-- cite -->` → `[N]<!-- ref -->` + a generated ```reference block, resolving DOIs against ENW/RIS files with `_index.json` fallback; idempotent renumbering; unresolved markers stay put and resolve when the library grows.
- **Code-region immunity**: markers inside inline code or fenced blocks never count — detection runs on a code-stripped, offset-preserving copy, so documentation showing markup examples is safe.
- **Zero-dependency implementation**: Node.js built-ins only; copy the folder into any project's `.agents/skills/` and it works.

## Install as a skill

```
git clone https://github.com/Laitangtang-lab-workflows/academic-markup ~/.agents/skills/academic-markup
```

Works with any agent harness supporting the SKILL.md convention (Claude Code, DeepSeek Harness, …). Requires Node.js and a `reference_materials/` library (built by the note-gen skill) for recall — everything else runs standalone.

## Repository layout

| Path | Content |
|---|---|
| `SKILL.md` | Skill entry point: the full pipeline, subcommands, marker cheat-sheet |
| `references/markup-dictionary.md` | The complete marker specification |
| `references/pipeline-workflow.md` | Step/file reference, operations/ layout, multi-manuscript internals |
| `references/process-ops-rules.md` | The rules governing the AI's creative step (annotation schema, per-type rules) |
| `references/build-references-design.md` | Design + implementation record of the citation-numbering engine |
| `scripts/enforce-markup.mjs` + `scripts/lib/` | The pipeline implementation (zero dependencies) |

## AI-maintained

Every file in this repository — code, documentation, this README — is written and updated by AI agents under human supervision, and the pipeline itself exists so that AI does the heavy lifting of manuscript processing under explicit, auditable rules. Expect commits to be machine-authored; humans review direction and decisions, not lines.

## License

[CC0-1.0](LICENSE) — released to the public domain. Use, fork and vendor it into anything, no attribution required (a nod is always appreciated).

By submitting a pull request you agree that your contributions are dedicated under CC0 as well.
