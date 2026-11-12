// assemble.mjs — Merge AI results (results.ndjson) with pending-ops.json into
// completed-ops.json. Wires extractor.buildResult + annotator.formatAnnotation
// so the AI never hand-writes annotation syntax, copies sourceRange, or risks
// emoji typos. This is the inverse of recall: recall feeds context IN to the
// AI; assemble normalizes the AI's lightweight output BACK to the strict
// completed-ops schema that integrate consumes.
//
// results.ndjson — one JSON object per line (AI appends these):
//   { "id": "ai-op-000", "result": "...", "annotationMeta": {...}, "warnings": [] }
//
// annotationMeta schema (per type):
//   rr: {aspect}            e.g. "expression" / "clarity"
//   gg: {source}            e.g. "tanner2005 notes" / "no local ref"
//   tt: {dir}               e.g. "zh→en" (default)
//   ee: {what}              e.g. "mechanism of extrudate swell"
//   cc: {}                  (empty — condense is unconditional)
//   vv: {status, detail}    status: verified|incorrect|conflicting|notFound|needDownload
//   cite: {key?, doi?, status?}   status omitted=local | "online" | "notFound"

import fs from 'fs';
import path from 'path';
import { buildResult } from './extractor.mjs';
import { formatAnnotation, formatVvAnnotation, vvInlineEmoji } from './annotator.mjs';
import { getOpsDir } from './paths.mjs';

/**
 * Assemble completed-ops.json from pending-ops.json + results.ndjson.
 * @param {string} [pendingPath]
 * @param {string} [ndjsonPath]
 * @param {string} [outputPath]
 * @returns {{error?: string} | {opCount, assembled, missing, byType}}
 */
export function runAssemble(
  pendingPath = path.join(getOpsDir(), 'pending-ops.json'),
  ndjsonPath = path.join(getOpsDir(), 'results.ndjson'),
  outputPath = path.join(getOpsDir(), 'completed-ops.json'),
) {
  if (!fs.existsSync(pendingPath)) {
    return { error: `pending-ops.json not found: ${pendingPath}` };
  }
  const pendingRaw = JSON.parse(fs.readFileSync(pendingPath, 'utf-8'));
  const pending = Array.isArray(pendingRaw)
    ? pendingRaw
    : (pendingRaw.results || pendingRaw.ops || []);

  // Index AI results by id (last write wins if duplicated)
  const ndjsonMap = new Map();
  if (fs.existsSync(ndjsonPath)) {
    const lines = fs.readFileSync(ndjsonPath, 'utf-8').split(/\r?\n/);
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        const obj = JSON.parse(t);
        if (obj.id) ndjsonMap.set(obj.id, obj);
      } catch {
        // skip malformed line
      }
    }
  }

  const results = [];
  const missing = [];
  const byType = {};

  // Iterate in pending (appearance) order so integrate's range-adjustment works
  for (const op of pending) {
    byType[op.type] = (byType[op.type] || 0) + 1;
    const line = ndjsonMap.get(op.id);
    if (!line) {
      missing.push(op.id);
      continue; // leave unprocessed — integrate keeps the original tag as-is
    }
    const meta = line.annotationMeta || {};
    const result = makeResult(op.type, op, line, meta);
    const annotation = makeAnnotation(op.type, meta);
    results.push(buildResult(op, result, annotation, { warnings: line.warnings || [] }));
  }

  fs.mkdirSync(getOpsDir(), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify({ results }, null, 2), 'utf-8');

  return { opCount: pending.length, assembled: results.length, missing, byType };
}

// ─── Per-type result / annotation construction ────────────────────

function makeResult(type, op, line, meta) {
  switch (type) {
    case 'vv':
      // Original claim (possibly corrected by AI) + inline status emoji
      return (line.result != null && line.result !== '' ? line.result : op.content || '')
        + vvInlineEmoji(meta.status);
    case 'cite':
      if (line.result) return line.result;
      // Unresolved: keep the marker (with its inline hint, if any) for a later re-run
      return meta.key ? `[@${meta.key}]` : `[['${op.hint ?? ''}']]`;
    default:
      return line.result || '';
  }
}

function makeAnnotation(type, meta) {
  switch (type) {
    case 'rr': return formatAnnotation('rr', meta.aspect || 'expression');
    case 'gg': return formatAnnotation('gg', meta.source || 'context');
    case 'tt': return formatAnnotation('tt', meta.dir || 'zh→en');
    case 'ee': return formatAnnotation('ee', meta.what || 'context');
    case 'cc': return formatAnnotation('cc', null);
    case 'vv': return formatVvAnnotation({ status: meta.status, detail: meta.detail });
    case 'cite':
      if (meta.status === 'notFound' || !meta.key) {
        return `<!-- cite: no ref found${op.hint ? ` (hint: ${op.hint})` : ''} -->`;
      }
      if (meta.status === 'online') {
        return `<!-- cite: @${meta.key} -> doi:${meta.doi || '?'} (📥 download needed) -->`;
      }
      return formatAnnotation('cite', { key: meta.key, doi: meta.doi });
    default:
      return '';
  }
}

export default { runAssemble };
