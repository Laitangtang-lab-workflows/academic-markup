// validator.mjs — Tag structure validation and error reporting
// v2: No nesting support. Checks: matching pairs, content constraints, accidental nesting.

import { TAG_DEFS, SINGLE_TAGS } from './patterns.mjs';
import { flattenTags } from './parser.mjs';

/**
 * Validate parsed AST and return structured report.
 * @param {Array} ast - Parsed nodes from parser.mjs
 * @param {string} sourceText - Original source text (for line number resolution)
 * @returns {ValidationReport}
 */
export function validate(ast, sourceText) {
  const errors = [];
  const warnings = [];
  const flat = flattenTags(ast, 0);

  // Count tags by type
  const byType = {};
  for (const key of Object.keys(TAG_DEFS)) {
    byType[key] = 0;
  }

  // Accumulate by-type counts and check for errors/warnings from flat list
  for (const node of flat) {
    byType[node.tagName] = (byType[node.tagName] || 0) + 1;

    // Check for unclosed tags
    if (node.error) {
      errors.push({
        type: 'UNCLOSED_TAG',
        message: node.error,
        node,
        line: getLineNumber(sourceText, node.absoluteStart),
      });
    }

    // Content warnings
    if ((node.tagName === 'gg' || node.tagName === 'ee' || node.tagName === 'cc') &&
        node.content && node.content.trim().length === 0) {
      warnings.push({
        type: 'EMPTY_CONTENT',
        message: `Tag '${node.tagName}' has empty content. Consider adding a hint for better results.`,
        node,
        line: getLineNumber(sourceText, node.absoluteStart),
      });
    }

    if (node.tagName === 'missing' && !node.params) {
      warnings.push({
        type: 'VAGUE_PLACEHOLDER',
        message: `[??] placeholder has no hint. Consider adding a hint: [??: what is needed].`,
        node,
        line: getLineNumber(sourceText, node.absoluteStart),
      });
    }

    // v2: Check for accidental nesting — tag start patterns inside content
    const nestingWarnings = checkContentForTagPatterns(node, sourceText);
    warnings.push(...nestingWarnings);
  }

  // Stats
  const totalTags = Object.values(byType).reduce((a, b) => a + b, 0);

  return {
    errors,
    warnings,
    stats: {
      totalTags,
      byType,
      maxNestingDepth: 0, // v2: nesting is disabled, always 0
      tagsNeedingAI: byType.gg + byType.rr + byType.tt + byType.vv + byType.ee + byType.cc + byType.cite,
      tagsInformational: byType.missing + byType.figure,
    },
  };
}

/**
 * Resolve character offset to line number (1-based).
 */
function getLineNumber(text, charOffset) {
  if (charOffset < 0 || charOffset > text.length) return 0;
  const before = text.slice(0, charOffset);
  return (before.match(/\n/g) || []).length + 1;
}

/**
 * Format a validation report for CLI output.
 */
export function formatReport(report) {
  const lines = [];

  lines.push('');
  lines.push('═'.repeat(56));
  lines.push('  VALIDATION REPORT');
  lines.push('═'.repeat(56));

  if (report.errors.length === 0 && report.warnings.length === 0) {
    lines.push('  ✅ All tags valid. No errors or warnings.');
    lines.push('═'.repeat(56));
    return lines.join('\n');
  }

  if (report.errors.length > 0) {
    lines.push(`  ❌ ${report.errors.length} error(s):`);
    for (const err of report.errors) {
      lines.push(`     [${err.type}] Line ${err.line}: ${err.message}`);
    }
  }

  if (report.warnings.length > 0) {
    lines.push(`  ⚠️  ${report.warnings.length} warning(s):`);
    for (const warn of report.warnings) {
      lines.push(`     [${warn.type}] Line ${warn.line}: ${warn.message}`);
    }
  }

  lines.push('═'.repeat(56));

  // Stats
  lines.push('');
  lines.push('  Tag count by type:');
  for (const [tag, count] of Object.entries(report.stats.byType)) {
    if (count > 0) {
      const def = TAG_DEFS[tag];
      const label = def ? def.name : tag;
      lines.push(`    ${tag} (${label}): ${count}`);
    }
  }
  lines.push(`  Total: ${report.stats.totalTags}`);
  lines.push(`  Needs AI: ${report.stats.tagsNeedingAI}`);
  lines.push(`  Max nesting depth: ${report.stats.maxNestingDepth}`);

  return lines.join('\n');
}

/**
 * Check tag content for accidental tag start patterns (v2: nesting is not supported).
 * Emits a warning if another tag's start pattern is found inside the content.
 */
function checkContentForTagPatterns(node, sourceText) {
  const warnings = [];
  if (!node.content || node.family === 'atomic') return warnings;

  const line = getLineNumber(sourceText, node.absoluteStart);

  // Build patterns for all wrapping tag starts (single-quote family)
  const patterns = [];
  for (const tag of SINGLE_TAGS) {
    patterns.push({ pattern: `${tag}'`, tag, desc: `${tag}'...'${tag}` });
  }

  for (const { pattern, tag, desc } of patterns) {
    // Only warn if a DIFFERENT tag's pattern is found (the same tag pattern inside
    // its own content would be an unclosed tag, already caught as an error)
    if (tag !== node.tagName && node.content.includes(pattern)) {
      warnings.push({
        type: 'NESTED_PATTERN',
        message: `Tag '${node.tagName}' content contains '${pattern}' — nesting is not supported in v2. ` +
                 `Use separate tags instead. Found "${desc}" pattern inside.`,
        node,
        line,
      });
    }
  }

  return warnings;
}

export default { validate, formatReport };
