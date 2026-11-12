// reference-manager.mjs — READ-ONLY utility module for reference_materials/
// Part of the academic-markup skill. This skill ONLY READS the reference
// library; it never creates or modifies it. Building the index (notes/fulltext)
// is the job of the separate「笔记生成」skill.
//
// Zero external dependencies. All paths relative to reference_materials/,
// stored with FORWARD SLASHES (path.join would emit backslashes on Windows and
// break index matching).
// v2 — reads _index.json v2 schema:
//   pdf/fulltext/notes (not *_path), title_en (not title), venue (not journal),
//   ref (ref-NNN) separate from id (filename stem).

import fs from 'fs';
import path from 'path';
import { getReferenceMaterialsDir, getJournalDir } from './paths.mjs';

// After dual-zone reorg: the journal _index.json lives under 期刊文献/, but entry
// relPaths remain relative to the reference_materials/ root (carrying a 期刊文献/
// prefix), so RM_DIR (used by absPath to resolve files) stays at the root.
const RM_DIR = getReferenceMaterialsDir();
const JOURNAL_DIR = getJournalDir();
const INDEX_PATH = path.join(JOURNAL_DIR, '_index.json');

// ─── Internal helpers ─────────────────────────────────────────────

function isPDF(filename) {
  return /\.pdf$/i.test(filename);
}

const EXCLUDED_DIRS = new Set(['_marker_tmp', '_ocr_tmp']);

/** Join relative path segments with forward slashes. */
function joinRel(base, name) {
  return base ? `${base}/${name}` : name;
}

/** Recursively list all PDF files (forward-slash rel paths). Read-only. */
function scanPDFs(dir, basePath = '') {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = joinRel(basePath, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      results.push(...scanPDFs(path.join(dir, entry.name), relPath));
    } else if (entry.isFile() && isPDF(entry.name)) {
      results.push(relPath);
    }
  }
  return results;
}

function absPath(relPath) {
  return path.join(RM_DIR, relPath);
}

// ─── Public API (read-only) ────────────────────────────────────────

/**
 * Scan reference_materials/ for all PDF files. Does NOT create the directory.
 * @returns {string[]} PDF relative paths (forward slashes, relative to reference_materials/)
 */
export function listAllPDFs() {
  // Scan journal zone only; basePath='期刊文献' so relPaths carry the prefix and
  // match index entries (which are relative to reference_materials/).
  return scanPDFs(JOURNAL_DIR, '期刊文献');
}

/**
 * Read _index.json (v2). Preserves all top-level metadata fields.
 * Returns an empty structure if the directory or index is missing — never throws,
 * never creates anything.
 * @returns {Object} index with entries[] (empty structure if missing)
 */
export function readIndex() {
  if (!fs.existsSync(INDEX_PATH)) {
    return { $schema: 'reference_materials notes index v2', entries: [], updated_at: '', total: 0, has_notes_count: 0 };
  }
  try {
    const raw = fs.readFileSync(INDEX_PATH, 'utf-8');
    const index = JSON.parse(raw);
    if (!index.entries) index.entries = [];
    if (index.updated_at === undefined) index.updated_at = index.updated || '';
    return index;
  } catch {
    return { $schema: 'reference_materials notes index v2', entries: [], updated_at: '', total: 0, has_notes_count: 0 };
  }
}

/**
 * Search index entries for a query string (space-separated terms, OR match).
 * Matches title_en, title_zh, keywords, topics, authors, venue, doi, takeaway.
 * Returns entries with `_score`, sorted by relevance descending.
 * @param {string} query
 * @param {Object} [index]
 * @returns {Array} Matching entries with _score
 */
export function searchIndex(query, index = null) {
  if (!index) index = readIndex();
  if (!query || !query.trim()) return [];
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results = [];
  for (const entry of index.entries) {
    let score = 0;
    const searchable = [
      (entry.title_en || '').toLowerCase(),
      (entry.title_zh || '').toLowerCase(),
      (entry.keywords || []).join(' ').toLowerCase(),
      (entry.topics || []).join(' ').toLowerCase(),
      (entry.authors || []).join(' ').toLowerCase(),
      (entry.venue || '').toLowerCase(),
      (entry.doi || '').toLowerCase(),
      (entry.takeaway || '').toLowerCase(),
    ].join(' ');
    for (const term of terms) {
      if (searchable.includes(term)) {
        const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        const matches = searchable.match(regex);
        score += matches ? matches.length : 0;
      }
    }
    if (score > 0) results.push({ ...entry, _score: score });
  }
  results.sort((a, b) => b._score - a._score);
  return results;
}

/**
 * Read the content of a file relative to reference_materials/.
 * @param {string} relPath
 * @returns {string|null}
 */
export function readFile(relPath) {
  if (!relPath) return null;
  const fullPath = absPath(relPath);
  if (!fs.existsSync(fullPath)) return null;
  try {
    return fs.readFileSync(fullPath, 'utf-8');
  } catch {
    return null;
  }
}

export default {
  listAllPDFs,
  readIndex,
  searchIndex,
  readFile,
};
