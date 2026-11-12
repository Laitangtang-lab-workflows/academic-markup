// paths.mjs — Centralized project-root resolution.
// Decouples the scripts from their install location: the "project root" is the
// user's current working directory, NOT the script's own directory. This lets
// the skill live anywhere (e.g. .agents/skills/academic-markup/scripts/) and
// still find the manuscript + reference_materials/ in whatever project the user
// is currently in.
//
// Override: set MARKUP_ROOT env var, or pass --root <dir> on the CLI (the
// enforce-markup entry point parses --root and sets the env before any lib
// module is imported).

import path from 'path';
import fs from 'fs';

/** The project root: MARKUP_ROOT env, else process.cwd(). */
export function getRootDir() {
  return process.env.MARKUP_ROOT || process.cwd();
}

/** <root>/operations — pipeline working files. */
export function getOpsDir() {
  return path.join(getRootDir(), 'operations');
}

/** <root>/reference_materials — the read-only reference library root (dual-zone: 期刊文献/ + 长篇文献/).
 * Walks UP from the project root, so a library shared one level above the
 * manuscript project (e.g. 1.DIW打印线条仿真/reference_materials/) is found
 * automatically; --root/MARKUP_ROOT still pins the starting point. */
export function getReferenceMaterialsDir() {
  let dir = getRootDir();
  for (;;) {
    const cand = path.join(dir, 'reference_materials');
    if (fs.existsSync(cand)) return cand;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(getRootDir(), 'reference_materials'); // not found — keep legacy path so existsSync callers report it
}

/** Journal zone subdir name. academic-markup recalls from here only; 长篇文献/ is excluded. */
export const JOURNAL_SUBDIR = '期刊文献';

/** <root>/reference_materials/期刊文献 — journal zone root (its _index.json is the recall source). */
export function getJournalDir() {
  return path.join(getReferenceMaterialsDir(), JOURNAL_SUBDIR);
}

/** True iff the journal zone exists. This skill NEVER creates it. */
export function referenceMaterialsExists() {
  return fs.existsSync(getJournalDir());
}

export default {
  getRootDir,
  getOpsDir,
  getReferenceMaterialsDir,
  getJournalDir,
  JOURNAL_SUBDIR,
  referenceMaterialsExists,
};
