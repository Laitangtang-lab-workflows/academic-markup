// recall.mjs — Build recall-context.json from pending-ops.json.
// For each operation: extract keywords → searchIndex → read notes (L1) then
// fulltext (L2) snippets → mark localResolved. Offloads ALL reference I/O
// and keyword matching from the AI: process-ops reads recall-context.json
// instead of doing the Step-0 search loop itself.
//
// Output shape (operations/recall-context.json):
//   { generated, source, ops: [{
//       id, type, content, keywords, contentKeywords,
//       relevantRefs: [{ id, title, titleZh, authors, year, doi, citeKey,
//                         score, source: notes|fulltext|index-only, snippet }],
//       localResolved: boolean
//   }] }

import fs from 'fs';
import path from 'path';
import * as rm from './reference-manager.mjs';
import { extractOpKeywords } from './keywords.mjs';
import { getOpsDir, referenceMaterialsExists, getRootDir } from './paths.mjs';

const MAX_TERMS = 30;        // cap query length (content terms first)
const TOP_N = 5;             // max refs with snippet extraction per op
const MIN_SCORE = 2;         // prefer multi-occurrence / multi-term hits
const SNIPPET_CHARS = 400;
const SNIPPET_SEGS = 2;      // notes: top-N relevant paragraphs
const FULLTEXT_WINDOWS = 2;  // fulltext: top-N keyword-line windows (±1 line)

// ─── Public API ───────────────────────────────────────────────────

/**
 * Run recall over pending-ops.json, writing recall-context.json.
 * @param {string} [pendingPath]
 * @param {string} [outputPath]
 * @returns {{error?: string} | {opCount, refCount, avgRefsPerOp, resolved, unresolved, byType}}
 */
export function runRecall(
  pendingPath = path.join(getOpsDir(), 'pending-ops.json'),
  outputPath = path.join(getOpsDir(), 'recall-context.json'),
) {
  // Hard-stop gate: this skill only READS reference_materials — it never creates it.
  if (!referenceMaterialsExists()) {
    return {
      error:
        `reference_materials/ not found under ${getRootDir()}. ` +
        `本 skill 只读取该目录、不负责创建。请先添加 reference_materials/ ` +
        `（其内容由「笔记生成」skill 产出）。流程中止。`,
    };
  }
  if (!fs.existsSync(pendingPath)) {
    return { error: `pending-ops.json not found: ${pendingPath}` };
  }
  const raw = JSON.parse(fs.readFileSync(pendingPath, 'utf-8'));
  const ops = Array.isArray(raw) ? raw : (raw.results || raw.ops || []);
  if (ops.length === 0) return { error: 'pending-ops.json is empty' };

  const index = rm.readIndex();
  const out = [];

  for (const op of ops) {
    const { terms, contentTerms } = extractOpKeywords(op);
    const queryTerms = terms.slice(0, MAX_TERMS);
    const queryStr = queryTerms.join(' ');

    // Prefer high-confidence hits; fall back to top-3 any-score for recall breadth
    let hits = rm
      .searchIndex(queryStr, index)
      .filter((h) => h._score >= MIN_SCORE)
      .slice(0, TOP_N);
    if (hits.length === 0) {
      hits = rm.searchIndex(queryStr, index).slice(0, 3);
    }

    // Inline cite hint ([['ref-002']] / [['doi:...']): targeted lookup that
    // outranks keyword hits — the author explicitly designated this reference.
    const hint = op.hint || null;
    let hintedEntry = null;
    if (hint) {
      const refId = hint.replace(/^ref-/i, '').replace(/^ref:/i, '');
      const doiKey = hint.replace(/^doi:/i, '').toLowerCase();
      hintedEntry =
        (index.entries || []).find((e) => (e.ref || '').toLowerCase() === `ref-${refId}`.toLowerCase()) ||
        (index.entries || []).find((e) => (e.doi || '').toLowerCase() === doiKey) ||
        null;
      if (hintedEntry) {
        // Put the designated ref first; keep keyword hits as context
        hits = [hintedEntry, ...hits.filter((h) => h !== hintedEntry)].slice(0, TOP_N);
      }
    }

    const relevantRefs = hits.map((h) => buildRefEntry(h, queryTerms));
    const localResolved = relevantRefs.some((r) => r.snippet);

    out.push({
      id: op.id,
      type: op.type,
      content: op.content,
      hint,
      hintResolved: hint ? Boolean(hintedEntry) : null,
      filePath: op.filePath || '',
      line: op.line || 0,
      keywords: queryTerms,
      contentKeywords: contentTerms,
      relevantRefs,
      localResolved,
    });
  }

  const payload = {
    generated: new Date().toISOString(),
    source: path.basename(pendingPath),
    ops: out,
  };
  fs.mkdirSync(getOpsDir(), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf-8');

  return summarize(out);
}

// ─── Internals ────────────────────────────────────────────────────

function buildRefEntry(entry, keywords) {
  const result = {
    id: entry.ref || entry.id,
    title: entry.title_en || '',
    titleZh: entry.title_zh || '',
    authors: entry.authors || [],
    year: entry.year || null,
    doi: entry.doi || '',
    citeKey: suggestCiteKey(entry),
    score: entry._score || 0,
    source: 'index-only',
    snippet: '',
  };

  // L1: notes (AI-distilled, highest density)
  const notes = rm.readFile(entry.notes);
  if (notes) {
    const snip = extractSnippet(notes, keywords, SNIPPET_CHARS, SNIPPET_SEGS);
    if (snip) {
      result.source = 'notes';
      result.snippet = snip;
      return result;
    }
  }
  // L2: fulltext (only when notes yield no keyword hit)
  const fulltext = rm.readFile(entry.fulltext);
  if (fulltext) {
    const snip = extractFulltextSnippet(fulltext, keywords, SNIPPET_CHARS, FULLTEXT_WINDOWS);
    if (snip) {
      result.source = 'fulltext';
      result.snippet = snip;
      return result;
    }
  }
  return result;
}

/** Suggest a pandoc citekey: lastname+year, fall back to doi-derived, then id. */
function suggestCiteKey(entry) {
  const year = entry.year || '';
  const authors = entry.authors || [];
  if (authors.length > 0) {
    const first = authors[0].trim();
    const parts = first.split(/\s+/);
    const last = parts[parts.length - 1].toLowerCase().replace(/[^a-z-]/g, '');
    if (last) return `${last}${year}`;
  }
  if (entry.doi) {
    return `doi${entry.doi.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 12)}`;
  }
  return entry.id || 'unknown';
}

function scoreText(text, keywords) {
  if (!text) return 0;
  const lower = text.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    const kwl = kw.toLowerCase();
    if (!kwl) continue;
    let idx = 0;
    while ((idx = lower.indexOf(kwl, idx)) !== -1) {
      score++;
      idx += kwl.length;
    }
  }
  return score;
}

function stripFrontmatter(text) {
  if (text.startsWith('---')) {
    const end = text.indexOf('\n---', 3);
    if (end !== -1) return text.slice(end + 4);
  }
  return text;
}

function truncate(s, max) {
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

/** Notes: strip frontmatter, split into paragraphs, take top-scored. */
function extractSnippet(text, keywords, maxChars, maxSegs) {
  if (!text) return '';
  const body = stripFrontmatter(text);
  const segs = body.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  const scored = segs
    .map((s) => ({ s, score: scoreText(s, keywords) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return '';
  return scored.slice(0, maxSegs).map((x) => truncate(x.s, maxChars)).join('\n…\n');
}

/** Fulltext: scan lines, take ±1-line windows around keyword hits. */
function extractFulltextSnippet(text, keywords, maxChars, maxWindows) {
  if (!text) return '';
  const lines = text.split('\n');
  const windows = [];
  for (let i = 0; i < lines.length && windows.length < maxWindows; i++) {
    if (scoreText(lines[i], keywords) > 0) {
      const start = Math.max(0, i - 1);
      const end = Math.min(lines.length, i + 2);
      const w = lines.slice(start, end).join('\n').trim();
      if (w) windows.push(truncate(w, maxChars));
    }
  }
  return windows.join('\n…\n');
}

function summarize(out) {
  const byType = {};
  let refCount = 0;
  let resolved = 0;
  for (const o of out) {
    byType[o.type] = (byType[o.type] || 0) + 1;
    refCount += o.relevantRefs.length;
    if (o.localResolved) resolved++;
  }
  return {
    opCount: out.length,
    refCount,
    avgRefsPerOp: +(refCount / out.length).toFixed(1),
    resolved,
    unresolved: out.length - resolved,
    byType,
  };
}

export default { runRecall };
