// parser.mjs — State-machine recursive descent parser for markup tags
// Slice-based: each recursive call works on a substring, positions are slice-relative

import { SINGLE_TAGS } from './patterns.mjs';

/**
 * Parse source text into AST of TextNode | TagNode.
 * @param {string} text - Full source text (used at top level; recursive calls use slices)
 * @returns {Array} Array of top-level nodes
 */
export function parse(text, offset = 0) {
  const nodes = [];
  let i = 0;

  while (i < text.length) {
    const tagStart = matchTagStart(text, i);
    if (tagStart) {
      const node = parseTag(text, i, tagStart, offset);
      if (node && node.end > i) {
        nodes.push(node);
        i = node.end;
        continue;
      }
    }
    // Find next tag start
    let nextTagPos = text.length;
    for (let j = i + 1; j < text.length; j++) {
      if (matchTagStart(text, j)) {
        nextTagPos = j;
        break;
      }
    }
    // Emit text node if there's text before next tag
    if (nextTagPos > i) {
      nodes.push({ type: 'text', value: text.slice(i, nextTagPos) });
    }
    i = nextTagPos;
  }

  return nodes;
}

/**
 * Detect which tag (if any) starts at position `pos` in `text`.
 * Returns { tagName, family, len } or null.
 */
function matchTagStart(text, pos) {
  const slice = text.slice(pos);

  // Atomic tags (check first)
  // Cite: atomic [['']] or with inline target hint [['ref-002']] / [['doi:...']]
  // (hint must not contain quotes/backslashes/brackets; escaped \' form stays compatible)
  const citeMatch = slice.match(/^\[\[\\?'([^'\]\\]*)\\?'\]\]/);
  if (citeMatch) {
    return { tagName: 'cite', family: 'atomic', len: citeMatch[0].length, hint: citeMatch[1] || null };
  }
  if (/^\[\?\?/.test(slice)) {
    const m = slice.match(/^\[\?\?(?::\s*([^\]]*))?\]/);
    if (m) return { tagName: 'missing', family: 'atomic', len: m[0].length };
  }
  if (/^\[fig:/.test(slice)) {
    const m = slice.match(/^\[fig:\s*([^\]]*)\]/);
    if (m) return { tagName: 'figure', family: 'atomic', len: m[0].length };
  }

  // Single-quote tags: tagName' but NOT tagName'' (two quotes is not a valid start)
  for (const tag of SINGLE_TAGS) {
    const prefix = tag + "'";
    if (slice.startsWith(prefix) && !slice.startsWith(prefix + "'")) {
      return { tagName: tag, family: 'single', len: prefix.length };
    }
  }

  return null;
}

/**
 * Parse a complete tag starting at absolute position `pos` in `text`.
 */
function parseTag(text, pos, tagStart, offset = 0) {
  const { tagName, family, len } = tagStart;

  if (family === 'atomic') {
    return parseAtomicTag(text, pos, tagName, len, offset, tagStart);
  }
  if (family === 'single') {
    return parseSingleTag(text, pos, tagName, len, offset);
  }
  return null;
}

// ─── Single-quote tag parser ─────────────────────────────────────
// No nested tags. Content is plain text between start and end markers.
// End marker: 'tagName (where preceding char is NOT another ')
function parseSingleTag(text, pos, tagName, prefixLen, offset = 0) {
  const contentStart = pos + prefixLen;
  const endMarker = `'${tagName}`;
  let i = contentStart;

  while (i < text.length) {
    // Check for end marker
    if (text[i] === "'" && (i === 0 || text[i - 1] !== "'")) {
      if (text.slice(i + 1, i + 1 + tagName.length) === tagName) {
        const afterEnd = i + 1 + tagName.length;
        const content = text.slice(contentStart, i);

        return {
          type: tagName, tagName, family: 'single',
          content, children: [],
          raw: text.slice(pos, afterEnd),
          start: pos, end: afterEnd,
          absoluteStart: offset + pos,
          absoluteEnd: offset + afterEnd,
        };
      }
    }

    i++;
  }

  return {
    type: tagName, tagName, family: 'single',
    content: text.slice(contentStart),
    children: [],
    raw: text.slice(pos),
    start: pos, end: text.length,
    absoluteStart: offset + pos,
    absoluteEnd: offset + text.length,
    error: `Unclosed single-quote tag '${tagName}': missing '${tagName}`,
  };
}

// ─── Atomic tag parser ───────────────────────────────────────────
function parseAtomicTag(text, pos, tagName, tagLen, offset = 0, tagStart = {}) {
  const raw = text.slice(pos, pos + tagLen);
  let params = null;

  if (tagName === 'cite') {
    return {
      type: 'cite', tagName: 'cite', family: 'atomic',
      content: '', children: [], raw,
      start: pos, end: pos + tagLen,
      absoluteStart: offset + pos, absoluteEnd: offset + pos + tagLen,
      params: null,
      hint: tagStart.hint || null,   // inline target: 'ref-002' | 'doi:...' | null
    };
  }

  if (tagName === 'missing') {
    const m = raw.match(/^\[\?\?(?::\s*([^\]]*))?\]/);
    if (m) params = (m[1] || '').trim() || null;
    return {
      type: 'missing', tagName: 'missing', family: 'atomic',
      content: '', children: [], raw,
      start: pos, end: pos + tagLen,
      absoluteStart: offset + pos, absoluteEnd: offset + pos + tagLen,
      params,
    };
  }

  if (tagName === 'figure') {
    const m = raw.match(/^\[fig:\s*([^\]]*)\]/);
    if (m) params = m[1].trim();
    return {
      type: 'figure', tagName: 'figure', family: 'atomic',
      content: '', children: [], raw,
      start: pos, end: pos + tagLen,
      absoluteStart: offset + pos, absoluteEnd: offset + pos + tagLen,
      params,
    };
  }

  return null;
}

// ─── Flat tag extraction ─────────────────────────────────────────

/** Flatten AST into a list of all TagNodes with absolute positions (no nesting). */
export function flattenTags(nodes, baseOffset = 0) {
  const flat = [];
  let offset = baseOffset;

  for (const node of nodes) {
    if (node.type === 'text') {
      offset += node.value.length;
    } else {
      const tagLen = (node.end - node.start) || node.raw.length;
      flat.push({
        ...node,
        absoluteStart: offset,
        absoluteEnd: offset + tagLen,
        children: [], // no nesting in v2
      });
      offset += tagLen;
    }
  }
  return flat;
}

/** Render AST back to text. */
export function renderAST(nodes) {
  let output = '';
  for (const node of nodes) {
    if (node.type === 'text') {
      output += node.value;
    } else {
      output += node.raw || '';
    }
  }
  return output;
}

export default { parse, flattenTags, renderAST };
