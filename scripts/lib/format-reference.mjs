// format-reference.mjs — Author name, journal abbreviation, and reference formatting
// Converts raw reference data into Additive Manufacturing journal citation style.
// Zero external dependencies.

// ─── ISO 4 Journal Word Abbreviation Table ─────────────────────────
// Rule-based: each word → abbreviated form. Unrecognized words → kept as-is
// with verbose-only warning. ALL-CAPS acronyms (ACS, CIRP, etc.) pass through.

const ISO4_TABLE = {
  // Standard abbreviations
  'Academy': 'Acad.',
  'Accounts': 'Acc.',
  'Additive': 'Addit.',
  'Advanced': 'Adv.',
  'Advances': 'Adv.',
  'American': 'Am.',
  'Analytical': 'Anal.',
  'Annals': 'Ann.',
  'Annual': 'Annu.',
  'Applied': 'Appl.',
  'Arabian': 'Arab.',
  'Archive': 'Arch.',
  'Association': 'Assoc.',
  'Behavior': 'Behav.',
  'Bioactive': 'Bioact.',
  'Biological': 'Biol.',
  'Biomedical': 'Biomed.',
  'British': 'Br.',
  'Bulletin': 'Bull.',
  'Canadian': 'Can.',
  'Ceramic': 'Ceram.',
  'Ceramics': 'Ceramics',
  'Micromachines': 'Micromachines',
  'Procedia': 'Procedia',
  'Chemical': 'Chem.',
  'Chemistry': 'Chem.',
  'Civil': 'Civ.',
  'Communications': 'Commun.',
  'Composite': 'Compos.',
  'Composites': 'Compos.',
  'Computational': 'Comput.',
  'Computer': 'Comput.',
  'Computers': 'Comput.',
  'Construction': 'Constr.',
  'Design': 'Des.',
  'Dynamics': 'Dyn.',
  'Engineering': 'Eng.',
  'Engineers': 'Eng.',
  'Environmental': 'Environ.',
  'European': 'Eur.',
  'Experimental': 'Exp.',
  'Extreme': 'Extreme',
  'Finite': 'Finite',
  'Fluid': 'Fluid',
  'Fluids': 'Fluids',
  'Food': 'Food',
  'Frontiers': 'Front.',
  'Functional': 'Funct.',
  'Heat': 'Heat',
  'Industrial': 'Ind.',
  'Institute': 'Inst.',
  'International': 'Int.',
  'Journal': 'J.',
  'Letters': 'Lett.',
  'Manufacturing': 'Manuf.',
  'Materials': 'Mater.',
  'Mechanical': 'Mech.',
  'Mechanics': 'Mech.',
  'Medicine': 'Med.',
  'Methods': 'Methods',
  'Modelling': 'Model.',
  'Modeling': 'Model.',
  'Molecular': 'Mol.',
  'Nano': 'Nano',
  'Nanotechnology': 'Nanotechnol.',
  'National': 'Natl.',
  'Natural': 'Nat.',
  'Non-Newtonian': 'Non-Newton.',
  'Numerical': 'Numer.',
  'Philosophical': 'Philos.',
  'Physical': 'Phys.',
  'Physics': 'Phys.',
  'Physiology': 'Physiol.',
  'Polymer': 'Polym.',
  'Polymers': 'Polym.',
  'Proceedings': 'Proc.',
  'Processing': 'Process.',
  'Progress': 'Prog.',
  'Reports': 'Rep.',
  'Research': 'Res.',
  'Review': 'Rev.',
  'Reviews': 'Rev.',
  'Rheology': 'Rheol.',
  'Royal': 'R.',
  'Science': 'Sci.',
  'Sciences': 'Sci.',
  'Scientific': 'Sci.',
  'Series': 'Ser.',
  'Society': 'Soc.',
  'Structures': 'Struct.',
  'Technology': 'Technol.',
  'Theoretical': 'Theor.',
  'Thermal': 'Therm.',
  'Transactions': 'Trans.',
  'Trends': 'Trends',
  'Zeitschrift': 'Z.',

  // Stop words → removed (filtered out after lookup)
  'of': '',
  'the': '',
  'The': '',
  'and': '&',
  'in': '',
  'for': '',
  'a': '',
  'an': '',
  'on': '',
  'at': '',
  'to': '',
  'by': '',
  'with': '',
};

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Format a reference line in the group's citation style (extracted from the
 * reference manuscript 格式参考-Manuscript-line-morphology-23.3.22-1.docx):
 *   [N] A. Author, B. Author, Title, J. Abbrev. Vol(Issue) (Year) Pages.
 * — number in brackets followed by a SPACE; issue attached to volume "129(2)";
 *   NO DOI at the end.
 *
 * Complete (source: enw/ris):
 *   [N] Authors, Title, Journal_Abbrev. Volume(Issue) (Year) Pages.
 *
 * Partial (source: index):
 *   [N] Authors, Title, Journal_Full (Year).
 *
 * @param {number} number — Citation number
 * @param {object} ref — Resolved reference object
 * @param {string[]} [unrecognizedWords] — Output array for verbose warnings about unrecognized journal words
 * @returns {string} Formatted reference line
 */
export function formatReference(number, ref, unrecognizedWords = null) {
  const authors = formatAuthors(ref.authors || []);
  const title = ref.title || ref.title_en || '';

  const parts = [authors, title];

  if (ref.source === 'enw' || ref.source === 'ris') {
    // Complete format: abbreviated journal, volume(issue) (year) pages
    const journalAbbr = abbreviateJournal(ref.venue, unrecognizedWords);

    let volInfo = '';
    if (ref.volume) volInfo = ref.volume;
    if (ref.issue) volInfo += `(${ref.issue})`;
    if (ref.year) volInfo += ` (${ref.year})`;
    if (ref.pages) volInfo += ` ${ref.pages}`;
    parts.push(journalAbbr, volInfo.trim());
  } else {
    // Partial format (index): full journal name, (year)
    parts.push(ref.venue || '');
    if (ref.year) parts.push(`(${ref.year})`);
  }

  return `[${number}] ` + parts.filter(Boolean).join(', ') + '.';
}

// ─── Author Name Conversion ────────────────────────────────────────

/**
 * Format author list for citation line.
 * Input: ["LastName, FirstName", ...] or ["First Last", ...]
 * Output: "I. LastName, I. LastName, ..." or "... et al." if > 10 authors
 *
 * @param {string[]} authors — Raw author strings
 * @returns {string} Formatted author list
 */
export function formatAuthors(authors) {
  if (!authors || authors.length === 0) return '';

  const formatted = authors.map(name => convertSingleAuthor(name));

  if (formatted.length <= 10) {
    return formatted.join(', ');
  }
  // > 10 authors: first 3 + et al.
  return formatted.slice(0, 3).join(', ') + ' et al.';
}

/**
 * Convert a single author name to "Initials. LastName" format.
 * Handles both "LastName, FirstName" (ENW/RIS) and "First Last" (index) formats.
 *
 * @param {string} name — Single author name string
 * @returns {string} Formatted as "I. LastName"
 */
function convertSingleAuthor(name) {
  const trimmed = name.trim();
  if (!trimmed) return '';

  if (trimmed.includes(',')) {
    // ENW/RIS format: "LastName, FirstName [MiddleName]"
    const [lastPart, ...givenParts] = trimmed.split(',').map(s => s.trim());
    const given = givenParts.join(' '); // Rejoin in case of "Last, First Middle"
    const initials = toInitials(given);
    return initials ? `${initials} ${lastPart}` : lastPart;
  } else {
    // Index format: "First [Middle] Last" or already "I.N. Last"
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) return parts[0];

    const last = parts[parts.length - 1];
    const given = parts.slice(0, -1).join(' ');

    // Check if already in initial form (e.g., "M.M.A. Spanjaards", "E.L. Gilmer")
    if (/^[A-Z][.A-Z]*\.?$/.test(parts[0]) && parts.length <= 3) {
      // Already initials — normalize dots
      const initTokens = parts.slice(0, -1).map(t => t.endsWith('.') ? t : t + '.');
      return `${initTokens.join('')} ${last}`;
    }

    const initials = toInitials(given);
    return initials ? `${initials} ${last}` : last;
  }
}

/**
 * Convert given name(s) to initials.
 * "Hyunwoo" → "H.", "Eric L." → "E.L.", "Jean-Paul" → "J.-P."
 *
 * @param {string} given — Given name string
 * @returns {string} Initials with periods
 */
function toInitials(given) {
  if (!given || !given.trim()) return '';

  // Split on whitespace to get individual given name tokens
  const tokens = given.trim().split(/\s+/);
  const initials = [];

  for (const token of tokens) {
    // Skip empty tokens
    if (!token) continue;

    // Check if already in initial form: single letter with optional period
    if (/^[A-Z]\.?$/.test(token)) {
      initials.push(token.endsWith('.') ? token : token + '.');
      continue;
    }
    // Multi-initial: "E.L." or "E.L"
    if (/^[A-Z]\.[A-Z]\.?$/.test(token)) {
      initials.push(token.endsWith('.') ? token : token + '.');
      continue;
    }

    // Hyphenated given name: "Jean-Paul" → "J.-P."
    if (token.includes('-')) {
      const parts = token.split('-').filter(Boolean);
      const hypInit = parts.map(p => p.charAt(0).toUpperCase() + '.').join('-');
      initials.push(hypInit);
      continue;
    }

    // Standard: first letter + period
    initials.push(token.charAt(0).toUpperCase() + '.');
  }

  return initials.join('');
}

// ─── Journal Abbreviation ──────────────────────────────────────────

/**
 * Abbreviate a full journal name using the ISO 4 word substitution table.
 * Words not in the table are kept as-is; ALL-CAPS acronyms pass through.
 *
 * @param {string} fullName — Full journal name
 * @param {string[]} [unrecognized] — Optional array to collect unrecognized words (for verbose warnings)
 * @returns {string} Abbreviated journal name
 */
export function abbreviateJournal(fullName, unrecognized = null) {
  if (!fullName) return '';

  // Split on whitespace while preserving commas (for "LNCS (ICCSA 2021), Springer")
  const tokens = fullName.split(/\s+/);
  const result = [];

  for (const token of tokens) {
    // Preserve parenthetical content: "(ICCSA 2021)"
    if (token.startsWith('(') && token.endsWith(')')) {
      result.push(token);
      continue;
    }

    // Handle trailing comma (e.g., "Springer,")
    let core = token;
    let suffix = '';
    if (token.endsWith(',') || token.endsWith(';')) {
      core = token.slice(0, -1);
      suffix = token.slice(-1);
    }

    // ALL-CAPS acronyms pass through (ACS, CIRP, PLA, LNCS, PhD, etc.)
    if (/^[A-Z]{2,}$/.test(core)) {
      result.push(token); // Keep original (with any suffix)
      continue;
    }

    // Numbers pass through (e.g., "3D")
    if (/^\d/.test(core)) {
      result.push(token);
      continue;
    }

    // Look up in table
    if (ISO4_TABLE.hasOwnProperty(core)) {
      const abbr = ISO4_TABLE[core];
      if (abbr) {
        result.push(abbr + suffix);
      }
      // If abbr is empty string (stop word), skip entirely
      continue;
    }

    // Not found → keep original, collect warning
    if (unrecognized && core.length > 1 && !/^[A-Z]\.?$/.test(core)) {
      unrecognized.push(core);
    }
    result.push(token);
  }

  return result.join(' ');
}

// ─── Exports ───────────────────────────────────────────────────────

export default {
  formatReference,
  formatAuthors,
  abbreviateJournal,
};
