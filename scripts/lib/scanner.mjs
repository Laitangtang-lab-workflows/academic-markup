// scanner.mjs — Scan manuscript for all markup tags and produce summary report
// Pure detection without full AST parsing — fast path for quick overview

import * as patterns from './patterns.mjs';
import { parse, flattenTags } from './parser.mjs';
import { validate, formatReport } from './validator.mjs';
import { stripCodeRegions } from './code-regions.mjs';

/**
 * Scan a markdown file and produce a comprehensive report.
 * Code-region immunity: detection runs on the code-stripped text (offset- and
 * line-preserving), so markup examples inside inline code / fenced blocks are
 * never reported.
 * @param {string} filePath - Path to the .md file
 * @returns {{ report: string, stats: object, errors: number, warnings: number }}
 */
export function scan(filePath, sourceText) {
  sourceText = stripCodeRegions(sourceText);
  const lines = sourceText.split('\n');

  // Quick regex-based tag count (fast path)
  const quickCounts = quickScan(sourceText);

  // Full parse + validate (thorough path)
  let fullReport = null;
  let errors = 0;
  let warnings = 0;
  try {
    const ast = parse(sourceText);
    const validation = validate(ast, sourceText);
    fullReport = formatReport(validation);
    errors = validation.errors.length;
    warnings = validation.warnings.length;
  } catch (e) {
    fullReport = `  ⚠️ Full parse failed: ${e.message}`;
    errors = 1;
  }

  // Build output
  const out = [];
  out.push('');
  out.push('═'.repeat(60));
  out.push('  MARKUP TAG SCAN REPORT');
  out.push('═'.repeat(60));
  out.push(`  File: ${filePath}`);
  out.push(`  Lines: ${lines.length}`);
  out.push('');

  out.push('  Quick Count (regex):');
  let totalQuick = 0;
  for (const [tag, def] of Object.entries(patterns.TAG_DEFS)) {
    const count = quickCounts[tag] || 0;
    if (count > 0 || tag === 'rr' || tag === 'gg') { // always show key tags
      const marker = count > 0 ? '  ' : '⬚ ';
      out.push(`    ${marker} ${tag} (${def.name}): ${count}`);
    }
    totalQuick += count;
  }
  out.push(`  ─────────────────────────`);
  out.push(`  Total quick count: ${totalQuick}`);

  if (totalQuick === 0) {
    out.push('');
    out.push('  No markup tags found. Manuscript is ready or empty.');
    out.push('═'.repeat(60));
    return {
      report: out.join('\n'),
      stats: { totalTags: 0, byType: quickCounts, lines: lines.length },
      errors: 0,
      warnings: 0,
    };
  }

  // Show tag locations
  out.push('');
  out.push('  Tag Locations:');
  const locations = findTagLocations(sourceText);
  for (const loc of locations) {
    const tagName = loc.tag;
    const preview = loc.preview.length > 50
      ? loc.preview.slice(0, 50) + '...'
      : loc.preview;
    out.push(`    Line ${loc.line}: ${tagName} → "${preview}"`);
  }

  // Full validation
  if (fullReport) {
    out.push('');
    out.push(fullReport);
  }

  out.push('');
  out.push(`  Next: node .agents/skills/academic-markup/scripts/enforce-markup.mjs extract`);
  out.push('═'.repeat(60));

  return {
    report: out.join('\n'),
    stats: { totalTags: totalQuick, byType: quickCounts, lines: lines.length },
    errors,
    warnings,
  };
}

/**
 * Quick regex-based scan (no parser, fast overview).
 */
function quickScan(text) {
  const counts = {};

  // Wrapping tags (single-quote family): count tagName' starts
  for (const tag of patterns.ALL_WRAPPING_TAGS) {
    const re = new RegExp(`${tag}'(?!')`, 'g');
    const matches = text.match(re);
    counts[tag] = matches ? matches.length : 0;
  }

  // Atomic
  counts.cite = (text.match(/\[\[\\?'[^'\]\\]*\\?'\]\]/g) || []).length;
  counts.missing = (text.match(/\[\?\?(?::[^\]]*)?\]/g) || []).length;
  counts.figure = (text.match(/\[fig:\s*[^\]]*\]/g) || []).length;

  return counts;
}

/**
 * Find all tag locations with line numbers and previews.
 */
function findTagLocations(text) {
  const locations = [];
  const lines = text.split('\n');

  // Search each line for tag patterns
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check for all tag types on this line
    const allTags = [
      ...patterns.ALL_WRAPPING_TAGS.map(t => ({ tag: t, re: new RegExp(`${t}'(?!')`, 'g') })),
      { tag: 'cite', re: /\[\[\\?'[^'\]\\]*\\?'\]\]/g },
      { tag: 'missing', re: /\[\?\?(?::[^\]]*)?\]/g },
      { tag: 'figure', re: /\[fig:\s*[^\]]*\]/g },
    ];

    for (const { tag, re } of allTags) {
      let match;
      re.lastIndex = 0;
      while ((match = re.exec(line)) !== null) {
        // Get ~40 chars of context around the tag
        const start = Math.max(0, match.index - 10);
        const end = Math.min(line.length, match.index + match[0].length + 30);
        const preview = line.slice(start, end).trim();
        locations.push({ tag, line: lineNum, col: match.index + 1, preview });
      }
    }
  }

  return locations.sort((a, b) => a.line - b.line || a.col - b.col);
}

export default { scan, quickScan, findTagLocations };
