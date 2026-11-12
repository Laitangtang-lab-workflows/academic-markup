#!/usr/bin/env node
// reference-builder.mjs — 引用编号与文献列表构建（refs 子命令的实现，管线第 8 步）。
// 由原独立脚本 工具脚本/build-references/build-references.mjs 并入改造，差异：
//   - 项目根改由 paths.mjs 解析（cwd / MARKUP_ROOT / --root），不依赖脚本安装位置；
//   - 手稿排除规则与 enforce-markup.mjs 对齐（CLAUDE.md + 隐藏/~/.bak）；
//   - 作为库模块被 refs 子命令调用；存在未解析引用时不置非零退出码
//     （未解析是"待补库"状态而非错误，串联进 /academic-markup 全流程时不应中断）。
//
// 数据流（与 academic-markup cite 步无缝衔接）：
//   模式A: [@citekey]<!-- cite: ... doi:10.xxx/yyy ... -->  ← cite 步输出（未解析）
//   模式B: [N]<!-- ref: doi:10.xxx/yyy source:XXX -->       ← 上次运行结果（幂等重编号）
//   模式C: [10.xxx/yyy]                                     ← 手写 DOI（不匹配注释内部）
//     → DOI 解析：reference/*.enw|.ris（元数据全）优先，期刊文献/_index.json 兜底
//     → 正文替换为 [N]<!-- ref: doi:... source:... -->，文末生成/覆写 ```reference 块
//
// 每次运行从头扫描、完全重新生成：未解析标记原样保留，文献库补全后重跑自动补上。

import fs from 'fs';
import path from 'path';
import { getRootDir, getJournalDir } from './paths.mjs';
import { parseReferenceDirectory } from './parse-reference-files.mjs';
import { formatReference } from './format-reference.mjs';
import { stripCodeRegions } from './code-regions.mjs';

// ─── File exclusion + subdirs (aligned with enforce-markup.mjs) ──────
// `--file` bypasses exclusion (explicit override). Lowercase compare.

const MANUSCRIPT_EXCLUDE = new Set([
  'agents.md', 'claude.md', 'readme.md', 'contributing.md', 'changelog.md', 'license.md',
]);

// Manuscript subdirectories scanned RECURSIVELY in addition to the flat root.
const MANUSCRIPT_SUBDIRS = ['手稿'];

function isExcluded(filename) {
  if (MANUSCRIPT_EXCLUDE.has(filename.toLowerCase())) return true;
  if (filename.endsWith('.bak')) return true;
  if (filename.startsWith('~')) return true;
  if (filename.startsWith('.')) return true;
  if (!filename.endsWith('.md')) return true;
  return false;
}

/** Recursively collect non-excluded .md files under `dir` into `acc`. */
function collectMdRecursive(dir, acc, depth = 0) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const fp = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (depth < 5) collectMdRecursive(fp, acc, depth + 1);
    } else if (ent.isFile() && !isExcluded(ent.name)) {
      acc.push(fp);
    }
  }
}

// ─── Regex Patterns ─────────────────────────────────────────────────

// Pattern A: unresolved [@citekey]<!-- cite: ... doi:10.xxx/yyy ... -->
// DOI 取贪婪 \S+（含括号——老 Elsevier DOI 如 10.1016/0021-9991(81)90145-5 合法含括号；
// 尾部标点由 normalizeDOI 清理），勿用 [^\s)>]+（会在 ')' 处截断括号 DOI）
// 中段用 tempered dot (?:(?!-->).)*? 约束不跨越 '-->'——否则无 DOI 的 cite 注释
// 会越界匹配到同行下一个注释的 DOI（实测：无 DOI 标记偷绑邻居 DOI）
const PATTERN_A = /\[@([^\]]+)\]\s*<!--\s*cite:\s*(?:(?!-->).)*?doi:(10\.\d{4,9}\/\S+)(?:(?!-->).)*?-->/g;

// Pattern B: previously resolved [N]<!-- ref: doi:10.xxx/yyy source:XXX -->
const PATTERN_B = /\[(\d+)\]\s*<!--\s*ref:\s*doi:(10\.\d{4,9}\/\S+)\s*(?:source:(\w+))?\s*-->/g;

// Pattern C: raw DOI [10.xxx/yyy] — MUST NOT match inside <!-- ... --> comments
// Strategy: first build a mask of comment ranges, then skip matches inside them.
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const PATTERN_C = /\[(10\.\d{4,9}\/[^\s\[\]]+)\]/g;

// Reference block: ```reference ... ```
const REF_BLOCK_RE = /```reference\n[\s\S]*?```/;

// Quick detection: does a text contain any citation marker at all?
const HAS_CITE_RE = /\[@[^\]]+\]\s*<!--\s*cite:|\[\d+\]\s*<!--\s*ref:\s*doi:|\[10\.\d{4,9}\/[^\s\[\]]+\]/;

// ─── DOI Normalization ──────────────────────────────────────────────

function normalizeDOI(raw) {
  if (!raw) return null;
  let doi = raw.trim();
  // Strip URL prefix
  doi = doi.replace(/^https?:\/\/[^\s/]*\/\s*/i, '');
  // Strip "doi:" prefix
  doi = doi.replace(/^doi:\s*/i, '');
  // Strip trailing punctuation that can't be part of DOI
  doi = doi.replace(/[.,;:)>]+$/, '');
  return doi.toLowerCase();
}

// ─── Citation Scanning ──────────────────────────────────────────────

/**
 * Scan manuscript text for all citation markers.
 * Returns the raw match list plus deduplicated DOIs in first-appearance order.
 *
 * @param {string} text — Full manuscript text
 * @returns {{ citations: Array, uniqueDois: string[] }}
 */
function scanCitations(text) {
  const citations = []; // { type, doi, rawMatch, citekey, prevNumber }

  // Patterns A and B live inside HTML comments — scan directly
  let match;

  // Pattern A: [@citekey]<!-- cite: ... doi:... -->
  PATTERN_A.lastIndex = 0;
  while ((match = PATTERN_A.exec(text)) !== null) {
    const doi = normalizeDOI(match[2]);
    if (!doi) continue;
    citations.push({
      type: 'A',
      doi,
      rawMatch: match[0],
      pos: match.index,       // Absolute position for safe in-place replacement
      citekey: match[1],
      prevNumber: null,
    });
  }

  // Pattern B: [N]<!-- ref: doi:... source:... -->
  PATTERN_B.lastIndex = 0;
  while ((match = PATTERN_B.exec(text)) !== null) {
    const doi = normalizeDOI(match[2]);
    if (!doi) continue;
    citations.push({
      type: 'B',
      doi,
      rawMatch: match[0],
      pos: match.index,
      citekey: null,
      prevNumber: parseInt(match[1], 10),
      prevSource: match[3] || null,
    });
  }

  // Pattern C: [10.xxx/yyy] — but ONLY outside HTML comments
  const commentRanges = [];
  HTML_COMMENT_RE.lastIndex = 0;
  while ((match = HTML_COMMENT_RE.exec(text)) !== null) {
    commentRanges.push({ start: match.index, end: match.index + match[0].length });
  }

  function isInsideComment(pos) {
    return commentRanges.some(r => pos >= r.start && pos < r.end);
  }

  PATTERN_C.lastIndex = 0;
  while ((match = PATTERN_C.exec(text)) !== null) {
    if (isInsideComment(match.index)) continue;
    const doi = normalizeDOI(match[1]);
    if (!doi) continue;
    citations.push({
      type: 'C',
      doi,
      rawMatch: match[0],
      pos: match.index,
      citekey: null,
      prevNumber: null,
    });
  }

  // Deduplicate DOIs in first-appearance order
  const seenDois = new Set();
  const uniqueDois = [];
  for (const c of citations) {
    if (!seenDois.has(c.doi)) {
      seenDois.add(c.doi);
      uniqueDois.push(c.doi);
    }
  }

  return { citations, uniqueDois };
}

// ─── Reference Resolution ───────────────────────────────────────────

/**
 * Resolve DOIs against reference data sources.
 * Priority: reference/ (.enw/.ris) > 期刊文献/_index.json
 *
 * @param {string[]} dois — Unique DOIs in order
 * @param {Map} enwRisMap — DOI → record from reference/ files
 * @param {Array} indexEntries — _index.json entries array
 * @returns {{ doiToRef: Map, unresolved: string[] }}
 */
function resolveReferences(dois, enwRisMap, indexEntries) {
  const doiToRef = new Map();
  const unresolved = [];

  // Build index lookup: doi → entry
  const indexByDoi = new Map();
  if (indexEntries) {
    for (const entry of indexEntries) {
      if (entry.doi) {
        const normalized = entry.doi.toLowerCase().trim();
        if (!indexByDoi.has(normalized)) {
          indexByDoi.set(normalized, entry);
        }
      }
    }
  }

  for (const doi of dois) {
    // Priority 1: reference/ ENW/RIS files (complete metadata)
    if (enwRisMap.has(doi)) {
      const refRec = enwRisMap.get(doi);
      doiToRef.set(doi, {
        doi,
        source: refRec.source,
        authors: refRec.authors || [],
        title: refRec.title || '',
        title_en: refRec.title || '',
        year: refRec.year || null,
        venue: refRec.venue || '',
        volume: refRec.volume || null,
        issue: refRec.issue || null,
        pages: refRec.pages || null,
        issn: refRec.issn || null,
        resolved: true,
      });
      continue;
    }

    // Priority 2: _index.json (partial metadata — no vol/iss/pages)
    if (indexByDoi.has(doi)) {
      const entry = indexByDoi.get(doi);
      doiToRef.set(doi, {
        doi,
        source: 'index',
        authors: entry.authors || [],
        title: entry.title_en || '',
        title_en: entry.title_en || '',
        year: entry.year || null,
        venue: entry.venue || '',
        volume: null,
        issue: null,
        pages: null,
        issn: null,
        resolved: true,
      });
      continue;
    }

    // Not found — leave the marker untouched for a later re-run
    unresolved.push(doi);
  }

  return { doiToRef, unresolved };
}

// ─── Citation Replacement ───────────────────────────────────────────

/**
 * Replace all resolvable citation markers in the manuscript text with
 * numbered citations. Unresolved markers are left as-is.
 *
 * @param {string} text — Original manuscript text
 * @param {Array} citations — Raw citation matches
 * @param {Map} doiToNumber — DOI → assigned number
 * @param {Map} doiToRef — DOI → resolved reference
 * @returns {string} Modified text
 */
function replaceCitations(text, citations, doiToNumber, doiToRef) {
  // Sort by position (reverse order for safe in-place replacement)
  const positioned = citations
    .filter(c => c.pos != null && c.rawMatch)
    .map(c => ({ ...c, len: c.rawMatch.length }))
    .sort((a, b) => b.pos - a.pos); // Reverse: replace from end to start

  let result = text;
  for (const c of positioned) {
    const num = doiToNumber.get(c.doi);
    if (num == null) continue; // Unresolved — leave original

    const ref = doiToRef.get(c.doi);
    const source = ref ? ref.source : 'index';
    const replacement = `[${num}]<!-- ref: doi:${c.doi} source:${source} -->`;

    // Verify the text at this position still matches (safety check)
    const currentSlice = result.slice(c.pos, c.pos + c.len);
    if (currentSlice !== c.rawMatch) {
      // Position shifted due to an earlier replacement above this point — skip
      continue;
    }

    result = result.slice(0, c.pos) + replacement + result.slice(c.pos + c.len);
  }

  return result;
}

// ─── Reference Block ────────────────────────────────────────────────

/**
 * Generate the ```reference code block with all resolved references.
 *
 * @param {Array} orderedRefs — [{ number, entry }] in citation order
 * @returns {string}
 */
function generateReferenceBlock(orderedRefs) {
  const lines = ['```reference'];
  for (const { number, entry } of orderedRefs) {
    lines.push(formatReference(number, entry));
  }
  lines.push('```');
  return lines.join('\n');
}

/**
 * Insert or replace the ```reference block in the manuscript.
 * Appends at end of file if no existing block is found.
 *
 * @param {string} text — Manuscript text
 * @param {string} block — Generated reference block
 * @returns {string}
 */
function upsertReferenceBlock(text, block) {
  if (REF_BLOCK_RE.test(text)) {
    return text.replace(REF_BLOCK_RE, block);
  }
  // Append at end with blank line separator
  return text.trimEnd() + '\n\n' + block + '\n';
}

// ─── Manuscript Detection ───────────────────────────────────────────

/**
 * Detect all .md files that contain citation markers.
 * Scans the flat project root PLUS each MANUSCRIPT_SUBDIRS recursively;
 * exclusion rules align with enforce-markup.mjs. Detection runs on the
 * code-stripped text so citation examples inside code regions don't count.
 *
 * @param {string} rootDir — Absolute project root
 * @returns {string[]} Array of absolute file paths
 */
function detectManuscripts(rootDir) {
  const candidates = [];
  try {
    for (const f of fs.readdirSync(rootDir)) {
      if (!isExcluded(f)) candidates.push(path.join(rootDir, f));
    }
  } catch { /* root unreadable */ }
  for (const sub of MANUSCRIPT_SUBDIRS) {
    collectMdRecursive(path.join(rootDir, sub), candidates);
  }

  const manuscripts = [];
  for (const fp of candidates) {
    let text;
    try {
      text = fs.readFileSync(fp, 'utf-8');
    } catch {
      continue;
    }
    if (HAS_CITE_RE.test(stripCodeRegions(text))) {
      manuscripts.push(fp);
    }
  }
  manuscripts.sort();
  return manuscripts;
}

// ─── Main ───────────────────────────────────────────────────────────

/**
 * Run the refs step: scan → resolve → number → write back.
 *
 * @param {object} options
 * @param {string|null} options.fileArg — Target one manuscript (bypasses auto-detect)
 * @param {boolean} options.dryRun — Preview without writing
 * @param {boolean} options.verbose — Detailed output
 * @returns {{ processed: number, resolved: number, unresolved: number, changed: number }}
 */
export async function runRefs({ fileArg = null, dryRun = false, verbose = false } = {}) {
  // Paths resolved via paths.mjs — honors MARKUP_ROOT / --root, not install location
  const rootDir = getRootDir();
  const refDir = path.join(rootDir, 'reference');            // optional ENW/RIS source
  const indexPath = path.join(getJournalDir(), '_index.json');

  if (verbose) {
    console.log('═'.repeat(54));
    console.log('  BUILD REFERENCES (refs)');
    console.log('═'.repeat(54));
    console.log(`  Project root: ${rootDir}`);
    console.log(`  Reference dir (ENW/RIS, optional): ${refDir}`);
    console.log(`  Index: ${indexPath}`);
    console.log('');
  }

  // ── Load reference data ──
  if (verbose) console.log('Loading reference data...');

  // Parse ENW/RIS files (graceful no-op if reference/ is absent)
  const { doiMap: enwRisMap, warnings: refWarnings } = parseReferenceDirectory(refDir, verbose);
  for (const w of refWarnings) {
    console.warn(`  ⚠ ${w}`);
  }
  if (verbose) {
    console.log(`  ENW/RIS: ${enwRisMap.size} DOI(s) loaded`);
  }

  // Read _index.json (hard requirement — the journal zone is the fallback source)
  let indexEntries = [];
  if (fs.existsSync(indexPath)) {
    try {
      const raw = fs.readFileSync(indexPath, 'utf-8');
      const index = JSON.parse(raw);
      indexEntries = index.entries || [];
      if (verbose) {
        const withDoi = indexEntries.filter(e => e.doi).length;
        console.log(`  _index.json: ${indexEntries.length} entries (${withDoi} with DOI)`);
      }
    } catch (err) {
      throw new Error(`Cannot parse _index.json: ${err.message}`);
    }
  } else {
    throw new Error(`reference_materials/期刊文献/_index.json not found: ${indexPath}`);
  }

  // ── Detect / resolve target manuscripts ──
  let targets = [];
  if (fileArg) {
    const fp = path.resolve(rootDir, fileArg);
    if (!fs.existsSync(fp)) {
      throw new Error(`File not found: ${fp}`);
    }
    targets.push(fp);
  } else {
    targets = detectManuscripts(rootDir);
  }

  if (targets.length === 0) {
    console.log('No manuscripts with citation markers found in project root.');
    return { processed: 0, resolved: 0, unresolved: 0, changed: 0 };
  }

  if (verbose) {
    console.log(`\nFound ${targets.length} manuscript(s):`);
    for (const t of targets) {
      console.log(`  - ${path.basename(t)}`);
    }
  }

  // ── Process each manuscript ──
  let totalResolved = 0;
  let totalUnresolved = 0;
  let totalComplete = 0;
  let totalPartial = 0;
  let changedFiles = 0;

  for (const filePath of targets) {
    const fileName = path.basename(filePath);
    console.log(`\n── ${fileName} ──`);

    // Read
    let text;
    try {
      text = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      console.error(`  Error reading file: ${err.message}`);
      continue;
    }

    // Scan — on the code-stripped text (offset-preserving) so citation
    // examples inside inline code / fenced blocks never count. The write-back
    // below still uses the ORIGINAL text + positions (markers outside code
    // regions are byte-identical in both).
    const { citations, uniqueDois } = scanCitations(stripCodeRegions(text));
    if (citations.length === 0) {
      console.log('  No citations found.');
      continue;
    }

    if (verbose) {
      console.log(`  Citations found: ${citations.length} (unique DOIs: ${uniqueDois.length})`);
      for (const c of citations) {
        const label = c.type === 'A' ? `@${c.citekey}` :
          c.type === 'B' ? `[${c.prevNumber}]` : `[DOI]`;
        console.log(`    ${label} → ${c.doi}`);
      }
    }

    // Resolve
    const { doiToRef, unresolved } = resolveReferences(uniqueDois, enwRisMap, indexEntries);

    // Assign numbers by first appearance
    const doiToNumber = new Map();
    const orderedRefs = [];
    let number = 1;
    for (const doi of uniqueDois) {
      if (doiToRef.has(doi)) {
        doiToNumber.set(doi, number);
        orderedRefs.push({ number, entry: doiToRef.get(doi) });
        number++;
      }
    }

    // Report
    const resolvedCount = doiToRef.size;
    const unresolvedCount = unresolved.length;
    const completeCount = orderedRefs.filter(r => r.entry.source === 'enw' || r.entry.source === 'ris').length;
    const partialCount = orderedRefs.filter(r => r.entry.source === 'index').length;

    console.log(`  Resolved: ${resolvedCount} (source: enw=${orderedRefs.filter(r => r.entry.source === 'enw').length}, ris=${orderedRefs.filter(r => r.entry.source === 'ris').length}, index=${partialCount})`);
    console.log(`  Complete (vol/iss/pg): ${completeCount}`);
    console.log(`  Incomplete (index only): ${partialCount}`);

    if (unresolvedCount > 0) {
      console.log(`  Unresolved: ${unresolvedCount}`);
      for (const doi of unresolved) {
        console.log(`    - ${doi} (not in reference/ or _index.json)`);
      }
    }

    totalResolved += resolvedCount;
    totalUnresolved += unresolvedCount;
    totalComplete += completeCount;
    totalPartial += partialCount;

    // If nothing resolved, skip file
    if (resolvedCount === 0) {
      console.log('  (no citations resolved — file unchanged)');
      continue;
    }

    // Replace citations, generate + upsert the reference block
    const modifiedText = replaceCitations(text, citations, doiToNumber, doiToRef);
    const refBlock = generateReferenceBlock(orderedRefs);
    const finalText = upsertReferenceBlock(modifiedText, refBlock);

    // Verbose: show the formatted reference list
    if (verbose) {
      console.log(`\n  Reference list:`);
      for (const { number: n, entry } of orderedRefs) {
        const srcLabel = entry.source === 'enw' ? '[ENW]' :
          entry.source === 'ris' ? '[RIS]' : '[index]';
        console.log(`    ${srcLabel} ${formatReference(n, entry)}`);
      }
    }

    // Write
    if (dryRun) {
      console.log(`\n  [DRY RUN] Would write: ${fileName}`);
      console.log(`  Citations replaced: ${resolvedCount}`);
      console.log(`  Reference block: ${orderedRefs.length} entries`);
    } else {
      // Backup first, then write
      const bakPath = filePath + '.bak';
      fs.writeFileSync(bakPath, text, 'utf-8');
      fs.writeFileSync(filePath, finalText, 'utf-8');
      changedFiles++;
      console.log(`  Wrote: ${fileName} (backup: ${fileName}.bak)`);
    }
  }

  // ── Global summary ──
  console.log('\n' + '═'.repeat(54));
  console.log('  SUMMARY');
  console.log('═'.repeat(54));
  console.log(`  Files processed: ${targets.length}`);
  console.log(`  Total resolved: ${totalResolved}`);
  console.log(`  Total unresolved: ${totalUnresolved}`);
  console.log(`  Complete (ENW/RIS): ${totalComplete}`);
  console.log(`  Incomplete (index only): ${totalPartial}`);

  if (totalUnresolved > 0) {
    console.log(`\n  To resolve remaining citations:`);
    console.log(`  1. Download the .enw or .ris file → reference/`);
    console.log(`  2. Or add the DOI to reference_materials/期刊文献/_index.json`);
    console.log(`  3. Re-run: node .agents/skills/academic-markup/scripts/enforce-markup.mjs refs`);
  }

  if (dryRun) {
    console.log(`\n  (Dry run — no files were modified)`);
  }

  return {
    processed: targets.length,
    resolved: totalResolved,
    unresolved: totalUnresolved,
    changed: changedFiles,
  };
}

export default { runRefs };
