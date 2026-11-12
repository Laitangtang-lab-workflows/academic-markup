#!/usr/bin/env node
// enforce-markup.mjs — CLI entry point for the academic-markup skill.
// Portable: resolves the project root from process.cwd() (or --root), NOT from
// this script's own location. Detects ALL manuscripts in the project root that
// contain valid markup, and supports multi-manuscript extract/integrate.
// Usage: node enforce-markup.mjs <command> [--file <path>] [--root <dir>] [--verbose] [--dry-run]

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, basename } from 'path';
import { getRootDir, getOpsDir } from './lib/paths.mjs';

// Filenames that are obviously NOT manuscripts (excluded from auto-detection).
// `--file` bypasses this list (explicit override). Lowercase compare.
const MANUSCRIPT_EXCLUDE = new Set([
  'agents.md', 'claude.md', 'readme.md', 'contributing.md', 'changelog.md', 'license.md',
]);

// Manuscript subdirectories scanned RECURSIVELY in addition to the flat project
// root (adjust per project; real manuscripts live here, not in the root).
const MANUSCRIPT_SUBDIRS = ['手稿'];

const SCRIPT_PATH = '.agents/skills/academic-markup/scripts/enforce-markup.mjs';

function isExcludedName(f) {
  if (MANUSCRIPT_EXCLUDE.has(f.toLowerCase())) return true;
  if (f.endsWith('.bak')) return true;
  if (f.startsWith('~') || f.startsWith('.')) return true;
  if (!f.endsWith('.md')) return true;
  return false;
}

/** Recursively collect non-excluded .md files under `dir` into `acc`. */
function collectMdRecursive(dir, acc, depth = 0) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const fp = resolve(dir, ent.name);
    if (ent.isDirectory()) {
      if (depth < 5) collectMdRecursive(fp, acc, depth + 1);
    } else if (ent.isFile() && !isExcludedName(ent.name)) {
      acc.push(fp);
    }
  }
}

// ─── CLI dispatcher ──────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  // Parse --root FIRST and export to env BEFORE any lib import (lib reads env
  // at module load via paths.mjs).
  const rootArg = extractArg(args, '--root');
  if (rootArg) process.env.MARKUP_ROOT = rootArg;

  const command = args[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    process.exit(0);
  }

  const verbose = args.includes('--verbose') || args.includes('-v');
  const dryRun = args.includes('--dry-run');
  const fileArg = extractArg(args, '--file', '-f');

  // Commands that do not require a manuscript file
  if (command === 'status') { await cmdStatus(); return; }
  if (command === 'recall') { await cmdRecall(verbose); return; }
  if (command === 'assemble') { await cmdAssemble(verbose); return; }
  if (command === 'report') { await cmdReport(); return; }

  switch (command) {
    case 'scan':      await cmdScan(fileArg, verbose); break;
    case 'validate':  await cmdValidate(fileArg, verbose); break;
    case 'extract':   await cmdExtract(fileArg, verbose); break;
    case 'integrate': await cmdIntegrate(fileArg, dryRun, verbose); break;
    case 'refs':      await cmdRefs(fileArg, dryRun, verbose); break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error('Available: scan, validate, extract, recall, assemble, integrate, report, refs, status, help');
      process.exit(1);
  }
}

// ─── Manuscript detection ────────────────────────────────────────

/**
 * Detect every manuscript that contains ≥1 valid AI-dependent marker.
 * Scans the flat project root PLUS each MANUSCRIPT_SUBDIRS recursively;
 * excludes config docs (AGENTS/CLAUDE/README/...) + hidden/temp/backup.
 * Code-region immunity: parsing runs on stripCodeRegions(text) — markup
 * examples inside inline code / fenced blocks never count as real markers.
 * A file is a "manuscript" iff createExtractOps yields ops for it — keeping
 * detection aligned with extract's actual behavior.
 * @returns {Promise<Array<{name, path, text, ops}>>} sorted by filename
 */
async function detectManuscripts() {
  const { parse } = await import('./lib/parser.mjs');
  const { createExtractOps } = await import('./lib/extractor.mjs');
  const { stripCodeRegions } = await import('./lib/code-regions.mjs');
  const root = getRootDir();

  // Candidate files: flat root + recursive manuscript subdirectories
  const candidates = [];
  try {
    for (const f of readdirSync(root)) {
      if (!isExcludedName(f)) candidates.push(resolve(root, f));
    }
  } catch { /* root unreadable */ }
  for (const sub of MANUSCRIPT_SUBDIRS) {
    collectMdRecursive(resolve(root, sub), candidates);
  }

  const manuscripts = [];
  for (const fp of candidates) {
    let text;
    try { text = readFileSync(fp, 'utf-8'); } catch { continue; }
    const stripped = stripCodeRegions(text);
    const ast = parse(stripped);
    const ops = createExtractOps(ast, stripped, fp);
    if (ops.length > 0) manuscripts.push({ name: basename(fp), path: fp, text: stripped, ops });
  }
  manuscripts.sort((a, b) => a.name.localeCompare(b.name));
  return manuscripts;
}

/**
 * Resolve the target file(s) for per-file commands (scan/validate).
 * `--file` → that one file; else all detected manuscripts.
 * Returned text is code-stripped (offset-preserving) for downstream parsing.
 * @returns {Promise<Array<{name, path, text}>>}
 */
async function resolveTargets(fileArg) {
  const { stripCodeRegions } = await import('./lib/code-regions.mjs');
  if (fileArg) {
    const fp = resolve(getRootDir(), fileArg);
    if (!existsSync(fp)) {
      console.error(`Error: File not found: ${fp}`);
      process.exit(1);
    }
    return [{ name: basename(fp), path: fp, text: stripCodeRegions(readFileSync(fp, 'utf-8')) }];
  }
  const manuscripts = await detectManuscripts();
  return manuscripts.map(m => ({ name: m.name, path: m.path, text: m.text }));
}

// ─── Commands ────────────────────────────────────────────────────

async function cmdScan(fileArg, verbose) {
  const { scan } = await import('./lib/scanner.mjs');
  const targets = await resolveTargets(fileArg);
  if (targets.length === 0) {
    console.log('No manuscripts with markers found in project root.');
    console.log('(Markers use single-quote syntax: gg\'..\'gg, rr\'..\'rr, vv\'..\'vv, ...)');
    return;
  }
  let errors = 0;
  console.log(`Found ${targets.length} manuscript(s):`);
  for (const t of targets) {
    console.log(`\n── ${t.name} ──`);
    const result = scan(t.name, t.text);
    console.log(result.report);
    errors += result.errors || 0;
  }
  if (errors > 0) process.exitCode = 1;
}

async function cmdValidate(fileArg, verbose) {
  const { parse } = await import('./lib/parser.mjs');
  const { validate, formatReport } = await import('./lib/validator.mjs');
  const targets = await resolveTargets(fileArg);
  if (targets.length === 0) {
    console.log('No manuscripts with markers found in project root.');
    return;
  }
  let errorCount = 0;
  for (const t of targets) {
    console.log(`\n── Validating: ${t.name} ──`);
    const ast = parse(t.text);
    const report = validate(ast, t.text);
    console.log(formatReport(report));
    errorCount += report.errors.length;
  }
  if (errorCount > 0) process.exitCode = 1;
}

async function cmdExtract(fileArg, verbose) {
  const { parse } = await import('./lib/parser.mjs');
  const { createExtractOps } = await import('./lib/extractor.mjs');

  let allOps = [];
  const sources = []; // {name, count}

  if (fileArg) {
    const targetFile = resolve(getRootDir(), fileArg);
    if (!existsSync(targetFile)) {
      console.error(`Error: File not found: ${targetFile}`);
      process.exit(1);
    }
    const { stripCodeRegions } = await import('./lib/code-regions.mjs');
    const stripped = stripCodeRegions(readFileSync(targetFile, 'utf-8'));
    const ops = createExtractOps(parse(stripped), stripped, targetFile);
    allOps = ops;
    sources.push({ name: basename(targetFile), count: ops.length });
  } else {
    const manuscripts = await detectManuscripts();
    if (manuscripts.length === 0) {
      console.log('No manuscripts with AI-dependent markers found in project root.');
      console.log('(Markers use single-quote syntax: gg\'..\'gg, rr\'..\'rr, vv\'..\'vv, ...)');
      return;
    }
    for (const m of manuscripts) {
      allOps.push(...m.ops);
      sources.push({ name: m.name, count: m.ops.length });
    }
  }

  if (allOps.length === 0) {
    console.log('No AI-dependent tags found. Manuscript is clean.');
    return;
  }

  // Assign GLOBAL sequential IDs across all manuscripts (file-sorted + appearance).
  allOps.forEach((op, i) => {
    op.id = `ai-op-${String(i).padStart(3, '0')}`;
  });

  const opsDir = getOpsDir();
  if (!existsSync(opsDir)) mkdirSync(opsDir, { recursive: true });
  writeFileSync(resolve(opsDir, 'pending-ops.json'), JSON.stringify(allOps, null, 2), 'utf-8');

  console.log(`Extracted ${allOps.length} operation(s) from ${sources.length} manuscript(s) → operations/pending-ops.json`);
  for (const s of sources) console.log(`  ${s.name}: ${s.count} op(s)`);
  if (verbose) {
    for (const op of allOps) {
      const preview = (op.content || '').slice(0, 60);
      console.log(`  [${op.id}] ${op.type} @ ${basename(op.filePath)}:${op.line}: "${preview}"`);
    }
  }
  console.log('');
  console.log('Next: recall + AI process-ops, then:');
  console.log(`  node ${SCRIPT_PATH} assemble`);
}

async function cmdIntegrate(fileArg, dryRun, verbose) {
  const opsDir = getOpsDir();
  const completedFile = resolve(opsDir, 'completed-ops.json');
  if (!existsSync(completedFile)) {
    console.error('Error: No completed-ops.json found. Run assemble first.');
    process.exit(1);
  }
  const completed = JSON.parse(readFileSync(completedFile, 'utf-8'));
  if (!completed.results || completed.results.length === 0) {
    console.log('No completed operations to integrate.');
    return;
  }

  // Group results by source file
  const groups = new Map();
  let skipped = 0;
  for (const r of completed.results) {
    const fp = r.filePath;
    if (!fp) { skipped++; continue; }
    if (!groups.has(fp)) groups.set(fp, []);
    groups.get(fp).push(r);
  }

  let targetFiles = [...groups.keys()];
  if (fileArg) {
    const abs = resolve(getRootDir(), fileArg);
    targetFiles = targetFiles.filter(fp => fp === abs);
    if (targetFiles.length === 0) {
      console.error(`Error: --file ${fileArg} has no completed results to integrate.`);
      process.exit(1);
    }
  }

  const { integrateResults } = await import('./lib/extractor.mjs');

  console.log(`Integrating ${completed.results.length} result(s) into ${targetFiles.length} manuscript(s)...${skipped ? ` (${skipped} skipped: no filePath)` : ''}`);

  for (const filePath of targetFiles) {
    const results = groups.get(filePath)
      .sort((a, b) => (a.sourceRange?.start ?? 0) - (b.sourceRange?.start ?? 0));
    const sourceText = readFileSync(filePath, 'utf-8');
    const newText = integrateResults(sourceText, results);

    if (dryRun) {
      console.log(`\n[DRY RUN] ${basename(filePath)}:`);
      const origLines = sourceText.split('\n');
      const newLines = newText.split('\n');
      let shown = 0;
      for (let i = 0; i < Math.max(origLines.length, newLines.length); i++) {
        if (origLines[i] !== newLines[i]) {
          if (i < origLines.length) console.log(`  < ${origLines[i]}`);
          if (i < newLines.length) console.log(`  > ${newLines[i]}`);
          shown++;
        }
      }
      if (shown === 0) console.log('  (no changes)');
      continue;
    }

    writeFileSync(filePath + '.bak', sourceText, 'utf-8');
    if (verbose) console.log(`  Backup: ${basename(filePath)}.bak`);
    writeFileSync(filePath, newText, 'utf-8');
    console.log(`  Updated: ${basename(filePath)} (${results.length} result(s))`);
  }

  if (!dryRun) {
    writeFileSync(completedFile, JSON.stringify({ results: [] }, null, 2), 'utf-8');
  }
}

async function cmdRecall(verbose) {
  const { runRecall } = await import('./lib/recall.mjs');
  const opsDir = getOpsDir();
  const pendingFile = resolve(opsDir, 'pending-ops.json');
  if (!existsSync(pendingFile)) {
    console.error('Error: No pending-ops.json. Run `extract` first.');
    process.exit(1);
  }
  const outputFile = resolve(opsDir, 'recall-context.json');
  const stat = runRecall(pendingFile, outputFile);
  if (stat.error) {
    console.error(`Error: ${stat.error}`);
    process.exit(1);
  }
  console.log(`Recalled context for ${stat.opCount} op(s) → operations/recall-context.json`);
  console.log(`  Refs attached: ${stat.refCount} (avg ${stat.avgRefsPerOp}/op)`);
  console.log(`  Locally resolved: ${stat.resolved}/${stat.opCount} (rest may need online search)`);
  console.log(`  Types: ${Object.entries(stat.byType).map(([t, n]) => `${t}=${n}`).join(', ') || 'none'}`);
  if (verbose) {
    const data = JSON.parse(readFileSync(outputFile, 'utf-8'));
    for (const op of data.ops) {
      console.log(`  [${op.id}] ${op.type} ${op.filePath ? '@ ' + basename(op.filePath) : ''} resolved=${op.localResolved} refs=${op.relevantRefs.length}`);
    }
  }
  console.log('');
  console.log('Next: have Claude process-ops reading recall-context.json, then:');
  console.log(`  node ${SCRIPT_PATH} assemble`);
}

async function cmdAssemble(verbose) {
  const { runAssemble } = await import('./lib/assemble.mjs');
  const opsDir = getOpsDir();
  const pendingFile = resolve(opsDir, 'pending-ops.json');
  if (!existsSync(pendingFile)) {
    console.error('Error: No pending-ops.json. Run `extract` first.');
    process.exit(1);
  }
  const ndjsonFile = resolve(opsDir, 'results.ndjson');
  const outputFile = resolve(opsDir, 'completed-ops.json');
  const stat = runAssemble(pendingFile, ndjsonFile, outputFile);
  if (stat.error) {
    console.error(`Error: ${stat.error}`);
    process.exit(1);
  }
  console.log(`Assembled ${stat.assembled}/${stat.opCount} result(s) → operations/completed-ops.json`);
  if (stat.missing.length > 0) {
    console.log(`  Missing AI results for ${stat.missing.length} op(s): ${stat.missing.join(', ')}`);
    console.log(`  (these tags will be left unchanged by integrate)`);
  }
  console.log(`  Types: ${Object.entries(stat.byType).map(([t, n]) => `${t}=${n}`).join(', ') || 'none'}`);
  if (verbose) {
    const data = JSON.parse(readFileSync(outputFile, 'utf-8'));
    for (const r of data.results) {
      const preview = (r.result || '').slice(0, 50);
      const where = r.filePath ? ' @ ' + basename(r.filePath) : '';
      console.log(`  [${r.id}] ${r.type}${where}: "${preview}" ${r.annotation}`);
    }
  }
  console.log('');
  console.log('Next: preview with `integrate --dry-run`, then apply with `integrate`.');
}

async function cmdReport() {
  const { runReport } = await import('./lib/report.mjs');
  const opsDir = getOpsDir();
  const stat = runReport(
    resolve(opsDir, 'completed-ops.json'),
    resolve(opsDir, 'pending-ops.json'),
    resolve(opsDir, 'recall-context.json'),
  );
  if (stat.error) {
    console.error(`Error: ${stat.error}`);
    process.exit(1);
  }
  console.log('═'.repeat(54));
  console.log('  PROCESSING REPORT');
  console.log('═'.repeat(54));
  console.log(`  Processed: ${stat.processed}/${stat.total || stat.processed} op(s)`);
  console.log(`  By type:   ${Object.entries(stat.byType).map(([t, n]) => `${t}=${n}`).join(', ') || 'none'}`);
  console.log(`  Warnings:  ${stat.warnings.length}`);
  for (const w of stat.warnings) {
    console.log(`    [${w.id}] ${w.warnings.join('; ')}`);
  }
  console.log(`  Citations: ${stat.citations.length ? stat.citations.join(', ') : 'none'}`);
  console.log(`  Locally unresolved (may need online search): ${stat.unresolvedCount}`);
  if (stat.unresolved.length) {
    console.log(`    ${stat.unresolved.join(', ')}`);
  }
  console.log('═'.repeat(54));
}

async function cmdStatus() {
  const opsDir = getOpsDir();
  const pendingFile = resolve(opsDir, 'pending-ops.json');
  const completedFile = resolve(opsDir, 'completed-ops.json');

  console.log('═'.repeat(40));
  console.log('  OPERATIONS PIPELINE STATUS');
  console.log('═'.repeat(40));
  console.log(`  Project root: ${getRootDir()}`);

  if (existsSync(pendingFile)) {
    const pending = JSON.parse(readFileSync(pendingFile, 'utf-8'));
    const count = Array.isArray(pending) ? pending.length : 0;
    console.log(`  Pending:  ${count} operation(s)`);
  } else {
    console.log('  Pending:  none (run extract first)');
  }

  if (existsSync(completedFile)) {
    const completed = JSON.parse(readFileSync(completedFile, 'utf-8'));
    const count = completed.results?.length || 0;
    console.log(`  Completed: ${count} operation(s)`);
  } else {
    console.log('  Completed: none');
  }

  console.log('═'.repeat(40));
}

async function cmdRefs(fileArg, dryRun, verbose) {
  // Citation numbering + reference-list step (pipeline step 8).
  // Unresolved DOIs are NOT an error — they stay in place for a later re-run
  // after the library grows, so no non-zero exit code is set here.
  const { runRefs } = await import('./lib/reference-builder.mjs');
  await runRefs({ fileArg, dryRun, verbose });
}

// ─── Helpers ─────────────────────────────────────────────────────

function printHelp() {
  console.log(`
enforce-markup.mjs — Manuscript Markup Enforcement (academic-markup skill)

Usage: node ${SCRIPT_PATH} <command> [options]

Commands:
  scan        Scan manuscript(s) for all markup tags, show statistics
  validate    Validate tag structure (nesting, pairing, rules)
  extract     Extract AI-dependent tags into operations/pending-ops.json
              (auto-detects ALL manuscripts in project root; multi-manuscript)
  recall      Attach relevant reference snippets → operations/recall-context.json
              (hard-stops if reference_materials/ is missing)
  assemble    Merge AI results.ndjson + pending-ops → completed-ops.json
  integrate   Write AI results back into manuscript(s) (creates *.md.bak)
              (groups results by source file; multi-manuscript)
  report      Summarize processed ops, warnings, citations, unresolved refs
  refs        Number citation markers → [N]<!-- ref --> + "reference" list
              (resolves DOIs via reference/*.enw|.ris + 期刊文献/_index.json;
               unresolved markers stay in place; creates *.md.bak)
  status      Show current pipeline status (pending/completed) + project root
  help        Show this help

Options:
  --file, -f   Target a specific manuscript (bypasses auto-detection)
  --root       Project root dir (default: current working directory)
  --verbose,-v Verbose output
  --dry-run    Preview integrate changes without writing

Examples:
  node ${SCRIPT_PATH} scan
  node ${SCRIPT_PATH} extract
  node ${SCRIPT_PATH} extract --file draft.md
  node ${SCRIPT_PATH} integrate --dry-run
  node ${SCRIPT_PATH} refs --dry-run --verbose
  node ${SCRIPT_PATH} scan --root /path/to/other/project
`);
}

function extractArg(args, ...flags) {
  for (const flag of flags) {
    const idx = args.indexOf(flag);
    if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  }
  return null;
}

// ─── Run ─────────────────────────────────────────────────────────
main().catch(err => {
  console.error('Fatal error:', err.message);
  if (process.argv.includes('--verbose')) console.error(err.stack);
  process.exit(1);
});
