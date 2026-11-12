// extractor.mjs — Extract AI-dependent tags into structured JSON for batch processing
// and integrate AI results back into the manuscript.
// Handles nested tags by depth-first extraction and range-adjusted integration.

import { TAG_DEFS } from './patterns.mjs';

// Tags that REQUIRE AI processing (cannot be handled deterministically)
const AI_TAGS = ['gg', 'rr', 'tt', 'vv', 'ee', 'cc', 'cite'];

/**
 * Create extract operations from parsed AST (flat — no nesting in v2).
 * Operations are sorted by appearance order (left to right).
 *
 * @param {Array} ast - Parsed AST nodes from parser.mjs
 * @param {string} sourceText - Full source text
 * @param {string} filePath - Path for reference
 * @param {number} contextWindow - Characters of context before/after (default 500)
 * @returns {Array} Array of AiOperation objects
 */
export function createExtractOps(ast, sourceText, filePath, contextWindow = 500) {
  const ops = [];
  walkAST(ast, sourceText, filePath, contextWindow, ops);

  // Assign sequential IDs in appearance order
  ops.forEach((op, i) => {
    op.id = `ai-op-${String(i).padStart(3, '0')}`;
  });

  return ops;
}

/** Walk AST flatly — no nesting, no depth tracking (v2). */
function walkAST(nodes, sourceText, filePath, contextWindow, ops) {
  for (const node of nodes) {
    if (node.type === 'text') continue;

    const tagName = node.tagName || node.type;

    // Only AI tags
    if (!AI_TAGS.includes(tagName)) continue;

    const def = TAG_DEFS[tagName];
    if (!def) continue;

    const absStart = node.absoluteStart ?? node.start ?? 0;
    const absEnd = node.absoluteEnd ?? node.end ?? 0;
    const ctxStart = Math.max(0, absStart - contextWindow);
    const ctxEnd = Math.min(sourceText.length, absEnd + contextWindow);

    ops.push({
      id: '', // assigned later
      type: tagName,
      name: def.name,
      content: node.content || '',
      params: node.params || null,
      hint: node.hint || null,   // cite inline target: 'ref-002' | 'doi:...' | null
      rawFull: node.raw || '',
      line: getLineNumber(sourceText, absStart),
      sourceRange: { start: absStart, end: absEnd },
      contextBefore: sourceText.slice(ctxStart, absStart),
      contextAfter: sourceText.slice(absEnd, ctxEnd),
      filePath,
    });
  }
}

/**
 * Integrate AI processing results back into the source text.
 * Results are processed in given order (should be deepest-first).
 * After each replacement, remaining overlapping ranges are adjusted.
 *
 * @param {string} sourceText - Original source text
 * @param {Array} results - Completed AI results (deepest-first)
 * @returns {string} Updated source text
 */
export function integrateResults(sourceText, results) {
  let text = sourceText;
  // Clone results so we can mutate ranges
  const working = results.map(r => ({
    ...r,
    sourceRange: r.sourceRange ? { ...r.sourceRange } : null,
  }));

  for (const result of working) {
    const sr = result.sourceRange;
    if (!sr || sr.start == null || sr.end == null) continue;
    if (sr.start >= text.length || sr.end > text.length) continue;

    let replacement = '';
    if (result.result != null) replacement += result.result;
    if (result.annotation) replacement += result.annotation;

    const oldLen = sr.end - sr.start;
    const delta = replacement.length - oldLen;

    // Apply
    text = text.slice(0, sr.start) + replacement + text.slice(sr.end);

    // Adjust ALL remaining results' ranges
    for (const other of working) {
      if (other === result || !other.sourceRange) continue;
      const osr = other.sourceRange;
      const oStart = osr.start ?? 0;
      const oEnd = osr.end ?? 0;

      if (oStart >= sr.end) {
        // Range is fully after replacement — shift both ends
        osr.start += delta;
        osr.end += delta;
      } else if (oStart <= sr.start && oEnd >= sr.end) {
        // Range encloses replacement (parent tag) — adjust end only
        osr.end += delta;
      }
      // else: before or partially overlapping — no change (shouldn't happen)
    }
  }

  return text;
}

/**
 * Build a completed result object from an operation.
 */
export function buildResult(op, resultText, annotation, extra = {}) {
  return {
    id: op.id,
    type: op.type,
    sourceRange: op.sourceRange ? { ...op.sourceRange } : null,
    filePath: op.filePath || '',
    content: op.content,
    result: resultText,
    annotation: annotation || '',
    ...extra,
  };
}

// Line number helper
function getLineNumber(text, charOffset) {
  if (charOffset < 0 || charOffset > text.length) return 0;
  return (text.slice(0, charOffset).match(/\n/g) || []).length + 1;
}

export default { createExtractOps, integrateResults, buildResult };
