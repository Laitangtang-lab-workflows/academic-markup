// patterns.mjs — Regex definitions for all 9 markup tags
// Part of enforce-markup: deterministic parsing of CLAUDE.md manuscript tags

// ─── Tag Metadata ───────────────────────────────────────────────
export const TAG_DEFS = {
  // Single-quote family: delimiter '...'
  rr: {
    family: 'single',
    name: 'Rewrite',
    commentTag: 'rw',
    commentDesc: 'improved',
    example: "rr'text to rewrite'rr",
  },
  tt: {
    family: 'single',
    name: 'Translate',
    commentTag: 'tt',
    commentDesc: 'zh→en',
    example: "tt'中文内容'tt",
  },
  vv: {
    family: 'single',
    name: 'Verify',
    commentTag: 'vv',
    commentDesc: null, // special: emoji-driven format
    example: "vv'factual claim'vv",
  },

  // Single-quote family: delimiter '...'  (unified — all wrapping tags use one quote)
  gg: {
    family: 'single',
    name: 'Generate',
    commentTag: 'gen',
    commentDesc: 'generated from {source}',
    example: "gg'hint for generation'gg",
  },
  ee: {
    family: 'single',
    name: 'Expand',
    commentTag: 'ee',
    commentDesc: 'expanded from {what}',
    example: "ee'brief point'ee",
  },
  cc: {
    family: 'single',
    name: 'Condense',
    commentTag: 'cc',
    commentDesc: 'condensed',
    example: "cc'wordy text'cc",
  },

  // Atomic family: self-contained; cite supports inline target hint
  cite: {
    family: 'atomic',
    name: 'Cite',
    commentTag: 'cite',
    commentDesc: null,
    example: "[['']] or [['ref-002']] or [['doi:10.xxx/yyy']]",
  },
  missing: {
    family: 'atomic',
    name: 'MissingInfo',
    commentTag: null,
    commentDesc: null,
    example: '[??] or [??: hint]',
  },
  figure: {
    family: 'atomic',
    name: 'Figure',
    commentTag: null,
    commentDesc: null,
    example: '[fig: description]',
  },
};

// ─── Wrapping tag names ─────────────────────────────────────────
// All wrapping tags use the single-quote family: tag'content'tag
export const SINGLE_TAGS = ['rr', 'tt', 'vv', 'gg', 'ee', 'cc'];
export const ALL_WRAPPING_TAGS = [...SINGLE_TAGS];

// ─── Regex Patterns ─────────────────────────────────────────────

// Single-quote tag start: tagName'  (but NOT tagName'' — two quotes is not a valid start)
// Build: (rr|tt|vv|gg|ee|cc)'(?!')
export const SINGLE_START_RE = () =>
  new RegExp(`(${SINGLE_TAGS.join('|')})'(?!')`, 'g');

// Single-quote tag end: 'tagName  (preceded by single ', not '')
// In parsing we check: char before is ', and char before that is NOT '
export const SINGLE_END_RE = () =>
  new RegExp(`'(?=${SINGLE_TAGS.join('|')})`, 'g');

// Atomic tags
export const CITE_RE = /\[\[\\?'[^'\]\\]*\\?'\]\]/g;   // [['']], [['ref-002']], [['doi:10.xxx/yyy']]
export const MISSING_RE = /\[\?\?(?::\s*([^\]]*))?\]/g;  // [??] or [??: hint]
export const FIGURE_RE = /\[fig:\s*([^\]]*)\]/g;  // [fig: description]

// ─── vv result emoji markers ────────────────────────────────────
export const VV_EMOJI = {
  verified:    { emoji: '✅', key: 'verified' },
  incorrect:   { emoji: '❌', key: 'incorrect' },
  conflicting: { emoji: '⚠️', key: 'conflicting' },
  notFound:    { emoji: '∅', key: 'notFound' },
  needDownload:{ emoji: '📥', key: 'needDownload' },
};

// ─── Utility: check if a string is a valid tag name ─────────────
export function isTagName(s) {
  return ALL_WRAPPING_TAGS.includes(s) ||
    ['cite', 'missing', 'figure'].includes(s);
}

export function getTagFamily(tagName) {
  return TAG_DEFS[tagName]?.family ?? null;
}

// ─── Utility: build end pattern for a specific single tag ───────
export function singleTagEnd(tagName) {
  return `'${tagName}`;
}
