// keywords.mjs — Extract search keywords from operation content + context.
// Serves recall.mjs: produces query terms for reference-manager.searchIndex().
// Zero external dependencies. Handles mixed Chinese/English academic text.
//
// Design notes:
//   - searchIndex() does case-insensitive `includes` per term and sums scores,
//     so multi-term hits rank higher. Noise terms rarely dominate.
//   - Domain content words (model/method/study/extrusion/viscosity/...) are
//     KEPT on purpose — they are low-discrimination but never dominate, and
//     dropping them risks losing real signal.
//   - No Chinese segmentation lib available: continuous Han runs ≤4 chars are
//     kept whole (likely terms); longer runs are decomposed into 2/3-grams so
//     that e.g. "挤出胀大现象" still surfaces 挤出 / 胀大 / 现象.

// ─── Stopword tables ──────────────────────────────────────────────

const STOPWORDS_EN = new Set([
  // articles
  'a', 'an', 'the',
  // prepositions
  'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'into', 'onto',
  'upon', 'over', 'under', 'between', 'through', 'during', 'before', 'after',
  'above', 'below', 'across', 'along', 'around', 'behind', 'beyond',
  // conjunctions
  'and', 'or', 'but', 'nor', 'so', 'yet', 'as', 'than', 'that', 'which',
  'while', 'whereas', 'although', 'though', 'because', 'since', 'unless',
  // pronouns
  'it', 'its', 'this', 'that', 'these', 'those', 'they', 'them', 'their',
  'we', 'our', 'us', 'he', 'she', 'his', 'her', 'who', 'whom', 'what',
  // be / auxiliary / modal
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'has', 'have',
  'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could', 'should',
  'shall', 'may', 'might', 'must',
  // misc function words
  'not', 'no', 'if', 'then', 'else', 'when', 'where', 'why', 'how', 'all',
  'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
  'only', 'own', 'same', 'too', 'very', 'also', 'well', 'about',
]);

// Chinese academic filler phrases (2+ chars). Domain content words
// (挤出/粘度/胀大/喷嘴/丝材/本构/剪切/屈服/流变...) are deliberately KEPT.
const STOPWORDS_ZH = new Set([
  '可以', '进行', '采用', '使用', '基于', '通过', '由于', '因此', '然而',
  '其中', '此外', '并且', '或者', '以及', '从而', '本文', '研究', '该',
  '一个', '一种', '一些', '上述', '如图', '所示', '如表', '例如',
]);

// Single Han characters that are function words / fillers. Any Chinese
// candidate (whole run or n-gram) containing one of these is dropped — this
// removes tokens like 对粘 / 度有 / 的挤 that leak through n-gram windowing.
const STOPCHARS_ZH = new Set([
  '的', '了', '是', '在', '和', '与', '及', '或', '等', '对', '为', '从', '由',
  '被', '将', '把', '给', '向', '于', '以', '其', '之', '而', '且', '并', '着',
  '过', '们', '地', '得', '即', '则', '这', '那', '某', '每', '各', '此', '彼',
  '有', '无', '所', '可', '能', '会', '已', '将', '正', '在',
]);

// ─── Helpers ──────────────────────────────────────────────────────

const MIN_LEN = 2;
const HAN_RUN_RE = /[一-龥]+/g;
const EN_WORD_RE = /[a-z][a-z0-9-]*/g;

function isAllDigits(s) {
  return /^\d+$/.test(s);
}

/** True if any Han character in `seg` is a stop character. */
function hasStopChar(seg) {
  for (const ch of seg) {
    if (STOPCHARS_ZH.has(ch)) return true;
  }
  return false;
}

/**
 * Extract de-duplicated search keywords from a text span.
 * Returns an array of terms (English words + Chinese n-grams), order-preserving.
 *
 * @param {string} text - content or context text (may be Chinese/English mixed)
 * @returns {string[]} unique keyword terms
 */
export function extractKeywords(text) {
  if (!text || typeof text !== 'string') return [];

  const lower = text.toLowerCase();
  const terms = [];
  const seen = new Set();

  const push = (t) => {
    if (!t || seen.has(t)) return;
    seen.add(t);
    terms.push(t);
  };

  // English / latin words. Drop 2-char pure-alpha tokens (re/mm/we/is) —
  // searchIndex uses substring `includes`, so "re" would match research /
  // region / result and dominate rankings. Domain acronyms are ≥3 chars
  // (DIW/FDM/VOF/PTT/CFD/PLA) or spelled out (Reynolds/Weber).
  const enMatches = lower.match(EN_WORD_RE) || [];
  for (const w of enMatches) {
    if (w.length < MIN_LEN) continue;
    if (isAllDigits(w)) continue;
    if (/^[a-z]+$/.test(w) && w.length < 3) continue;
    if (STOPWORDS_EN.has(w)) continue;
    push(w);
  }

  // Chinese: split into continuous Han runs. Runs ≤4 chars are kept whole
  // (likely a term like 挤出胀大 / 粘度); longer runs decompose into 2-grams
  // only (3-grams are too sparse to match title/keyword fields).
  const zhRuns = text.match(HAN_RUN_RE) || [];
  for (const run of zhRuns) {
    if (run.length <= 4) {
      if (STOPWORDS_ZH.has(run) || hasStopChar(run)) continue;
      push(run);
      continue;
    }
    for (let i = 0; i + 2 <= run.length; i++) {
      const g = run.slice(i, i + 2);
      if (STOPWORDS_ZH.has(g)) continue;
      if (hasStopChar(g)) continue;
      push(g);
    }
  }

  return terms;
}

/**
 * Extract keywords from an operation, giving content terms precedence.
 * Content is the tag body (the actual claim/hint/text); context is the
 * surrounding manuscript text. Returns { terms, contentTerms }.
 *
 * @param {object} op - operation with `content`, `contextBefore`, `contextAfter`
 * @returns {{ terms: string[], contentTerms: string[] }}
 */
export function extractOpKeywords(op) {
  const contentTerms = extractKeywords(op?.content || '');
  const ctxTerms = extractKeywords(
    `${op?.contextBefore || ''} ${op?.contextAfter || ''}`,
  );
  // Content terms first (priority), then context-only terms
  const terms = [...contentTerms];
  const seen = new Set(contentTerms);
  for (const t of ctxTerms) {
    if (!seen.has(t)) {
      seen.add(t);
      terms.push(t);
    }
  }
  return { terms, contentTerms };
}

export default { extractKeywords, extractOpKeywords };
