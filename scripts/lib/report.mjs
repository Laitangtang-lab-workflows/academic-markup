// report.mjs — Summarize pipeline state from completed-ops.json (with
// recall-context.json cross-reference). Offloads Step-4 statistics from the AI.

import fs from 'fs';
import path from 'path';
import { getOpsDir } from './paths.mjs';

/**
 * Build a report over completed-ops.json, cross-referencing pending-ops.json
 * (coverage) and recall-context.json (local resolution status).
 * @param {string} [completedPath]
 * @param {string} [pendingPath]
 * @param {string} [recallPath]
 * @returns {{error?: string} | {total, processed, byType, warnings, citations, unresolvedCount, unresolved}}
 */
export function runReport(
  completedPath = path.join(getOpsDir(), 'completed-ops.json'),
  pendingPath = path.join(getOpsDir(), 'pending-ops.json'),
  recallPath = path.join(getOpsDir(), 'recall-context.json'),
) {
  if (!fs.existsSync(completedPath)) {
    return { error: `completed-ops.json not found: ${completedPath}` };
  }

  // Pending total (coverage denominator)
  let total = 0;
  if (fs.existsSync(pendingPath)) {
    const raw = JSON.parse(fs.readFileSync(pendingPath, 'utf-8'));
    const pending = Array.isArray(raw) ? raw : (raw.results || raw.ops || []);
    total = pending.length;
  }

  const completed = JSON.parse(fs.readFileSync(completedPath, 'utf-8'));
  const results = completed.results || [];

  const byType = {};
  const warnings = [];
  const citations = [];

  for (const r of results) {
    byType[r.type] = (byType[r.type] || 0) + 1;
    if (Array.isArray(r.warnings) && r.warnings.length > 0) {
      warnings.push({ id: r.id, warnings: r.warnings });
    }
    if (r.type === 'cite') {
      // extract @key from the assembled annotation
      const m = (r.annotation || '').match(/@([\w-]+)/);
      if (m) citations.push(m[1]);
    }
  }

  // Cross-reference recall-context.json for local resolution
  let unresolved = [];
  if (fs.existsSync(recallPath)) {
    const recall = JSON.parse(fs.readFileSync(recallPath, 'utf-8'));
    unresolved = (recall.ops || [])
      .filter((o) => !o.localResolved)
      .map((o) => o.id);
  }

  return {
    total,
    processed: results.length,
    byType,
    warnings,
    citations,
    unresolvedCount: unresolved.length,
    unresolved,
  };
}

export default { runReport };
