// parse-reference-files.mjs — ENW and RIS file parser
// Scans reference/ directory, extracts structured citation data, builds DOI lookup map.
// Zero external dependencies — Node.js built-ins only.

import fs from 'fs';
import path from 'path';

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Parse all .enw and .ris files in the reference/ directory.
 * @param {string} refDir — Absolute path to the reference/ directory
 * @param {boolean} verbose — Print per-file parse details
 * @returns {Map<string, object>} doi → {authors, title, year, venue, volume, issue, pages, issn, source}
 */
export function parseReferenceDirectory(refDir, verbose = false) {
  const doiMap = new Map(); // doi → record
  const warnings = [];

  if (!fs.existsSync(refDir)) {
    if (verbose) console.log(`  (reference/ directory not found: ${refDir})`);
    return { doiMap, warnings };
  }

  let files;
  try {
    files = fs.readdirSync(refDir);
  } catch {
    if (verbose) console.log(`  (cannot read reference/ directory: ${refDir})`);
    return { doiMap, warnings };
  }

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (ext !== '.enw' && ext !== '.ris') continue;

    const filePath = path.join(refDir, file);
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      warnings.push(`Cannot read ${file}: ${err.message}`);
      continue;
    }

    let records = [];
    try {
      if (ext === '.enw') {
        records = parseENWContent(content);
      } else {
        records = parseRISContent(content);
      }
    } catch (err) {
      warnings.push(`Parse error in ${file}: ${err.message}`);
      continue;
    }

    for (const rec of records) {
      if (!rec.doi) {
        warnings.push(`${file}: record has no DOI, skipping`);
        continue;
      }
      const normalizedDoi = rec.doi.toLowerCase();
      if (doiMap.has(normalizedDoi)) {
        // Don't overwrite — first parsed wins (enw files sorted before ris in readdir)
        continue;
      }
      doiMap.set(normalizedDoi, {
        authors: rec.authors || [],
        title: rec.title || '',
        year: rec.year || null,
        venue: rec.journal || '',
        volume: rec.volume || null,
        issue: rec.issue || null,
        pages: rec.pages || null,
        issn: rec.issn || null,
        source: rec.source, // 'enw' or 'ris'
      });
    }

    if (verbose) {
      console.log(`  ✓ ${file}: ${records.length} record(s) — ${records.map(r => r.doi || 'no-DOI').join(', ')}`);
    }
  }

  return { doiMap, warnings };
}

// ─── ENW Parser ────────────────────────────────────────────────────

/**
 * Parse EndNote tagged format (.enw) content.
 * ENW uses %TAG value on each line. Records start with %0.
 *
 * Relevant tags:
 *   %0 — Record type (Journal Article, Book, etc.)
 *   %A — Author (repeatable, one per line)
 *   %T — Title
 *   %D — Year (YYYY)
 *   %J — Journal name
 *   %V — Volume
 *   %N — Issue/Number
 *   %P — Pages
 *   %@ — ISSN/ISBN
 *   %R — DOI (as full URL: https://doi.org/10.xxx/yyy)
 *   %U — URL
 *   %X — Abstract
 *
 * @param {string} content
 * @returns {Array<object>}
 */
function parseENWContent(content) {
  const records = [];
  const lines = content.split('\n');

  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || !line.startsWith('%')) continue;

    const tag = line.charAt(1); // Single-char tag after %
    const value = line.slice(2).trim();
    if (!value) continue;

    if (tag === '0') {
      // New record starts
      if (current) records.push(current);
      current = {
        authors: [],
        title: '',
        year: '',
        journal: '',
        volume: '',
        issue: '',
        pages: '',
        issn: '',
        doi: '',
        source: 'enw',
      };
      continue;
    }

    if (!current) continue; // No %0 header yet

    switch (tag) {
      case 'A': current.authors.push(value); break;
      case 'T': current.title = current.title || value; break; // First %T wins (title)
      case 'D': current.year = value; break;
      case 'J': current.journal = value; break;
      case 'V': current.volume = value; break;
      case 'N': current.issue = value; break;
      case 'P': current.pages = value; break;
      case '@': current.issn = value; break;
      case 'R':
        // DOI URL → extract raw DOI
        current.doi = extractDOI(value);
        break;
      case 'U':
        // URL — try extracting DOI if not already found
        if (!current.doi) current.doi = extractDOI(value);
        break;
      // %X (Abstract), %K (Keywords), %8 (Date), etc. — ignored
    }
  }

  if (current) records.push(current);

  return records.filter(r => r.doi || r.title); // Keep records with at least a DOI or title
}

// ─── RIS Parser ────────────────────────────────────────────────────

/**
 * Parse RIS format (.ris) content.
 * RIS uses TAG  - value on each line (2-char tag, space, dash, space, value).
 * Records start with TY and end with ER.
 *
 * Relevant tags:
 *   TY — Record type (JOUR, BOOK, etc.)
 *   AU — Author (repeatable)
 *   T1 — Primary title
 *   PY — Year (YYYY, sometimes with /MM/DD suffix)
 *   JO — Journal name (full)
 *   VL — Volume
 *   IS — Issue
 *   SP — Start page
 *   EP — End page
 *   SN — ISSN/ISBN
 *   DO — DOI (as full URL)
 *   UR — URL
 *   KW — Keywords (repeatable)
 *   AB — Abstract
 *   ER — End of record
 *
 * @param {string} content
 * @returns {Array<object>}
 */
function parseRISContent(content) {
  const records = [];
  const lines = content.split('\n');

  let current = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // RIS format: "TAG  - value" (2-char tag, 2+ spaces, dash, space, value)
    // The "  - " separator is 4 chars: space, space, dash, space
    const tagMatch = trimmed.match(/^([A-Z0-9]{2})\s{2,}-\s+(.*)$/);
    if (!tagMatch) continue;

    const [, tag, value] = tagMatch;
    const val = value.trim();

    if (tag === 'TY') {
      if (current) records.push(current);
      current = {
        type: val,
        authors: [],
        title: '',
        year: '',
        journal: '',
        volume: '',
        issue: '',
        sp: '',
        ep: '',
        pages: null,
        issn: '',
        doi: '',
        source: 'ris',
      };
      continue;
    }

    if (tag === 'ER') {
      if (current) {
        // Finalize pages: combine SP-EP
        if (current.sp || current.ep) {
          current.pages = [current.sp, current.ep].filter(Boolean).join('–');
        }
        records.push(current);
        current = null;
      }
      continue;
    }

    if (!current) continue;

    switch (tag) {
      case 'AU': current.authors.push(val); break;
      case 'TI':   // 标准 RIS 标题字段（cite 生成的 RIS 用 TI）
      case 'T1': current.title = current.title || val; break;
      case 'PY':
        // Strip date suffix: "2005/08/30/" → "2005"
        current.year = val.replace(/[/\s].*$/, '');
        break;
      case 'JO': current.journal = val; break;
      case 'VL': current.volume = val; break;
      case 'IS': current.issue = val; break;
      case 'SP': current.sp = val; break;
      case 'EP': current.ep = val; break;
      case 'SN': current.issn = val; break;
      case 'DO':
        current.doi = extractDOI(val);
        break;
      case 'UR':
        if (!current.doi) current.doi = extractDOI(val);
        break;
      // T2, JA, KW, AB, N1, M1, M2, etc. — ignored
    }
  }

  // In case file ends without ER
  if (current) {
    if (current.sp || current.ep) {
      current.pages = [current.sp, current.ep].filter(Boolean).join('–');
    }
    records.push(current);
  }

  return records.filter(r => r.doi || r.title);
}

// ─── DOI Extraction ────────────────────────────────────────────────

/**
 * Extract raw DOI from various URL/identifier formats.
 * Handles:
 *   - https://doi.org/10.xxx/yyy
 *   - http://dx.doi.org/10.xxx/yyy
 *   - doi:10.xxx/yyy
 *   - 10.xxx/yyy (bare DOI)
 *
 * @param {string} raw — Raw DOI field value (may be URL)
 * @returns {string|null} Normalized DOI, or null if not found
 */
function extractDOI(raw) {
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();

  // Match: optional URL prefix, optional "doi:" prefix, then 10.NNNN/suffix
  const doiMatch = trimmed.match(
    /(?:https?:\/\/[^\s/]*\/)?(?:doi:)?(10\.\d{4,9}\/[^\s]+)/i
  );

  if (doiMatch) {
    // Clean trailing punctuation (.,) etc.) that may be stuck to DOI
    let doi = doiMatch[1].replace(/[.,;:)\]]+$/, '').toLowerCase();
    return doi;
  }

  return null;
}

// ─── Exports ───────────────────────────────────────────────────────

export default {
  parseReferenceDirectory,
  parseENWContent,
  parseRISContent,
  extractDOI,
};
