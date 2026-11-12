// annotator.mjs — HTML comment formatter for AI output annotations
// Ensures all annotations follow CLAUDE.md format rules consistently.

import { TAG_DEFS, VV_EMOJI } from './patterns.mjs';

/**
 * Format an annotation comment for a given tag type and details.
 * Returns a string like: <!-- rw: improved expression -->
 *
 * @param {string} tagType - 'gg' | 'rr' | 'tt' | 'vv' | 'ee' | 'cc' | 'cite'
 * @param {object|string} details - Either a string description, or for vv: { status, source, detail }
 * @returns {string} Formatted HTML comment
 */
export function formatAnnotation(tagType, details) {
  const def = TAG_DEFS[tagType];
  if (!def || !def.commentTag) return '';

  const commentTag = def.commentTag; // 'rw', 'gen', 'tt', 'vv', 'ee', 'cc', 'cite'

  switch (tagType) {
    case 'rr':
      return `<!-- rw: improved ${typeof details === 'string' ? details : 'expression'} -->`;

    case 'gg':
      return `<!-- gen: generated from ${typeof details === 'string' ? details : 'context'} -->`;

    case 'tt': {
      const dir = typeof details === 'string' ? details : 'zh→en';
      return `<!-- tt: ${dir} -->`;
    }

    case 'ee':
      return `<!-- ee: expanded from ${typeof details === 'string' ? details : 'context'} -->`;

    case 'cc':
      return `<!-- cc: condensed -->`;

    case 'cite': {
      if (typeof details === 'string') {
        return `<!-- cite: ${details} -->`;
      }
      return `<!-- cite: @${details.key || '?'} -> doi:${details.doi || '?'} -->`;
    }

    case 'vv':
      return formatVvAnnotation(details);

    default:
      return `<!-- ${commentTag}: ${details} -->`;
  }
}

/**
 * Format a vv (verify) annotation with emoji and details.
 * @param {object} result - { status: 'verified'|'incorrect'|'conflicting'|'notFound'|'needDownload',
 *                            detail: string, sources: string[] }
 */
export function formatVvAnnotation(result) {
  if (!result || !result.status) return '<!-- vv: unprocessed -->';

  const emojiMap = {
    verified: '✅',
    incorrect: '❌',
    conflicting: '⚠️',
    notFound: '∅',
    needDownload: '📥',
  };

  const emoji = emojiMap[result.status] || '❓';
  const detail = result.detail || '';

  switch (result.status) {
    case 'verified':
      return `<!-- vv: ✅ — verified via ${detail} -->`;
    case 'incorrect':
      return `<!-- vv: ❌ — corrected: ${detail} -->`;
    case 'conflicting':
      return `<!-- vv: ⚠️ — conflicting evidence: ${detail} -->`;
    case 'notFound':
      return `<!-- vv: ∅ — searched "${detail}", no relevant ref found -->`;
    case 'needDownload':
      return `<!-- vv: 📥 — download needed: ${detail} -->`;
    default:
      return `<!-- vv: ${detail} -->`;
  }
}

/**
 * Generate the inline visible emoji for vv results.
 * This goes in the rendered text (visible), while the annotation goes in the comment.
 */
export function vvInlineEmoji(status) {
  const map = {
    verified: ' ✅',
    incorrect: ' ❌',
    conflicting: ' ⚠️',
    notFound: ' ∅',
    needDownload: ' 📥',
  };
  return map[status] || '';
}

export default { formatAnnotation, formatVvAnnotation, vvInlineEmoji };
