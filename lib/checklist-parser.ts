// checklist-parser.ts
// Parses three checklist formats: Topps PDF (numbered & code-based) and Panini CSV.
// Also parses Topps odds PDFs.

export type ParsedCard = {
  playerName: string;
  team?: string;
  cardNumber?: string;    // "10", "SM-AB", etc.
  isRookie: boolean;
  isSP: boolean;
  hasBackVariation: boolean;
  printRun?: number;      // from CSV SEQUENCE
  rawLine: string;
  // XLSX/Bowman parsers set this when a data block listed parallel labels
  // ("Refractor", "Gold /50", "SuperFractor /1"). The importer expands each
  // card into one variant row per parallel (plus "Base"). Absent/empty = single
  // variant named after the containing section.
  parallels?: string[];
};

export type ParsedSection = {
  sectionName: string;
  cards: ParsedCard[];
  flagged: string[];      // lines that matched card-like pattern but couldn't fully parse
};

export type ParsedChecklist = {
  productName: string;
  detectedFormat: 'topps-pdf-numbered' | 'topps-pdf-code' | 'panini-csv' | 'generic';
  sections: ParsedSection[];
};

export type ParsedOdds = {
  rows: Array<{ subsetName: string; hobbyOdds: string; breakerOdds: string | null }>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripTrademarkSymbols(s: string): string {
  return s.replace(/[®™]/g, '').trim();
}

// Does a line look like it could contain card data (has a number or letter-dash-alphanum code)?
function looksCardLike(line: string): boolean {
  return /^\s+\d+\s+\S/.test(line) || /^\s*[A-Z]+-[A-Z0-9]+\s+\S/.test(line);
}

// Is a line a section header?
// Rules: all caps (after trimming), no leading digits, no ® or ™, not a skip line.
// We allow spaces and common punctuation in headers.
function isSectionHeader(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/[®™]/.test(trimmed)) return false;
  if (/SUBJECT TO CHANGE/i.test(trimmed)) return false;
  // Must be ALL_CAPS (letters, spaces, slashes, dashes, apostrophes allowed)
  if (!/^[A-Z][A-Z\s\-/''()&0-9]*$/.test(trimmed)) return false;
  // Must not start with digits
  if (/^\d/.test(trimmed)) return false;
  // Must have at least 2 chars and contain at least one alpha
  if (trimmed.length < 2) return false;
  if (!/[A-Z]/.test(trimmed)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Topps PDF – numbered format
// Example line:
//   "       10 Aaron Judge                    New York Yankees®"
//   "       48 Dylan Beavers                  Baltimore Orioles®     Rookie"
//   "       20 Jonathan Aranda*               Tampa Bay Rays™"
//   "      360 Owen Caissie*                  Chicago Cubs®          Rookie     *Back Variation"
//
// Regex groups:
//   1: card number
//   2: player name (may end with *)
//   3: * (SP marker) — optional
//   4: team name (before ® or ™)
//   5: "Rookie" — optional
//   6: "*Back Variation" — optional
// ---------------------------------------------------------------------------
const NUMBERED_LINE_RE =
  /^\s{2,}(\d+)\s{1,6}([A-Z][A-Za-z\s'.\-]+?)(\*)?\s{2,}([^®™\n]+?)[®™](?:\s+(Rookie))?(?:\s+(\*Back Variation))?[\s]*$/;

// Newer Topps PDFs (2025-26 Cosmic Chrome onward) dropped the ®/™ team markers
// that the old regex required. extractPdfText in app/api/admin/parse-checklist
// joins each cell-positioned text item with 3 spaces, so \s{2,} between fields
// is reliable regardless of how the visual layout looks. Card numbers can carry
// a trailing asterisk for footnoted entries (e.g. "101*" for Nikola Jović in
// Cosmic Chrome — see footnote on page 3 of that checklist). Unicode flag for
// accented player/team names (Jović, Dončić, Niederhäuser).
const NUMBERED_LINE_NO_TM_RE =
  /^\s{2,}(\d+)\*?\s{2,}(\S(?:.*?\S)?)\s{2,}(\S(?:.*?\S)?)(?:\s{2,}(Rookie))?\s*$/u;

function parseNumberedLine(line: string): ParsedCard | null {
  // Try strict (old Topps with ®/™ + *SP markers) first so existing imports
  // don't change behavior.
  const m = line.match(NUMBERED_LINE_RE);
  if (m) {
    return {
      cardNumber: m[1].trim(),
      playerName: m[2].trim(),
      isSP: m[3] === '*',
      team: stripTrademarkSymbols(m[4].trim()),
      isRookie: !!m[5],
      hasBackVariation: !!m[6],
      rawLine: line,
    };
  }
  // Fallback for newer Topps PDFs without ®/™.
  const lenient = line.match(NUMBERED_LINE_NO_TM_RE);
  if (lenient) {
    return {
      cardNumber: lenient[1].trim(),
      playerName: stripTrademarkSymbols(lenient[2].trim()),
      isSP: false,
      team: stripTrademarkSymbols(lenient[3].trim()),
      isRookie: !!lenient[4],
      hasBackVariation: false,
      rawLine: line,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Topps PDF – code format
// Example: "SM-AB  Player Name   Team Name®"
//          "RHS-AB Player Name   Team Name™"
// Regex groups:
//   1: code (e.g. SM-AB)
//   2: player name
//   3: team name
// ---------------------------------------------------------------------------
const CODE_LINE_RE =
  /^\s*([A-Z]+-[A-Z0-9]+)\s{2,}([A-Z][A-Za-z\s'.\-]+?)\s{2,}([^®™\n]+?)[®™]\s*$/;

// Looser version for when there's only one gap of whitespace (some PDFs condense spacing)
const CODE_LINE_LOOSE_RE =
  /^\s*([A-Z]+-[A-Z0-9]+)\s+([A-Z][A-Za-z\s'.\-]+?)\s{2,}([^®™\n]+?)[®™]\s*$/;

// Newer Topps PDFs (Cosmic Chrome 2025-26+) drop the ®/™ markers — same
// rationale as NUMBERED_LINE_NO_TM_RE. Captures optional trailing Rookie flag,
// which the older regex variants don't expose for code-format rows.
const CODE_LINE_NO_TM_RE =
  /^\s*([A-Z]+-[A-Z0-9]+)\s{2,}(\S(?:.*?\S)?)\s{2,}(\S(?:.*?\S)?)(?:\s{2,}(Rookie))?\s*$/u;

function parseCodeLine(line: string): ParsedCard | null {
  const m = line.match(CODE_LINE_RE) ?? line.match(CODE_LINE_LOOSE_RE);
  if (m) {
    return {
      cardNumber: m[1].trim(),
      playerName: m[2].trim(),
      team: stripTrademarkSymbols(m[3].trim()),
      isRookie: false,   // older code-based sets don't mark rookie in-line
      isSP: false,
      hasBackVariation: false,
      rawLine: line,
    };
  }
  const lenient = line.match(CODE_LINE_NO_TM_RE);
  if (lenient) {
    return {
      cardNumber: lenient[1].trim(),
      playerName: stripTrademarkSymbols(lenient[2].trim()),
      team: stripTrademarkSymbols(lenient[3].trim()),
      isRookie: !!lenient[4],
      isSP: false,
      hasBackVariation: false,
      rawLine: line,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Format detection
// Scan first ~50 non-empty, non-header lines. If the first card-like line
// uses a code pattern (LETTERS-ALPHANUM) → code format, else → numbered.
// ---------------------------------------------------------------------------
function detectToppsFormat(lines: string[]): 'topps-pdf-numbered' | 'topps-pdf-code' {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (isSectionHeader(line)) continue;
    if (/SUBJECT TO CHANGE/i.test(line)) continue;

    // Code-based line starts with a code like SM-AB or RHS-AN (no leading digits)
    if (/^\s*[A-Z]{1,4}-[A-Z0-9]{1,4}\s/.test(line) && /[®™]/.test(line)) {
      return 'topps-pdf-code';
    }
    // Numbered line
    if (/^\s{2,}\d+\s/.test(line) && /[®™]/.test(line)) {
      return 'topps-pdf-numbered';
    }
  }
  return 'topps-pdf-numbered'; // default
}

// ---------------------------------------------------------------------------
// parseChecklistPdf
// ---------------------------------------------------------------------------
export function parseChecklistPdf(text: string): ParsedChecklist {
  const lines = text.split('\n');
  const format = detectToppsFormat(lines);

  // Extract a product name from first non-empty lines (before first section header)
  let productName = '';
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    // If it looks like a title-case or mixed-case line before headers, use it
    if (!isSectionHeader(line) && !/[®™]/.test(line) && !/^\d/.test(t)) {
      productName = t;
      break;
    }
  }

  const sections: ParsedSection[] = [];
  let currentSection: ParsedSection = { sectionName: 'BASE', cards: [], flagged: [] };

  // Try BOTH parsers on every line. Cosmic Chrome 2025-26 (and presumably newer
  // Topps releases) interleaves numbered base sections with code-prefixed
  // insert sections (GG-1 / ET-5 / PRP-3 etc.) in the same PDF — picking one
  // parser based on `format` would miss half the cards. The detected `format`
  // is now informational only, kept on the return value so callers know which
  // pattern dominates.
  for (const line of lines) {
    if (!line.trim()) continue;
    if (/SUBJECT TO CHANGE/i.test(line)) continue;

    // Skip lines that are clearly page numbers or footers (pure digits on their own)
    if (/^\s*\d+\s*$/.test(line)) continue;

    if (isSectionHeader(line)) {
      const headerName = line.trim();
      // Push the current section only if it has content or is the very first
      if (currentSection.cards.length > 0 || currentSection.flagged.length > 0) {
        sections.push(currentSection);
      }
      currentSection = { sectionName: headerName, cards: [], flagged: [] };
      continue;
    }

    if (looksCardLike(line)) {
      const card = parseNumberedLine(line) ?? parseCodeLine(line);
      if (card) {
        currentSection.cards.push(card);
      } else {
        currentSection.flagged.push(line);
      }
    }
  }

  // Push final section
  if (currentSection.cards.length > 0 || currentSection.flagged.length > 0) {
    sections.push(currentSection);
  }

  return { productName, detectedFormat: format, sections };
}

// ---------------------------------------------------------------------------
// parseChecklistCsv  (Panini CSV format)
// ---------------------------------------------------------------------------

// Parse a single quoted-CSV line, respecting escaped quotes inside fields.
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      // Quoted field
      i++; // skip opening quote
      let field = '';
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          field += '"';
          i += 2;
        } else if (line[i] === '"') {
          i++; // skip closing quote
          break;
        } else {
          field += line[i++];
        }
      }
      fields.push(field);
      // skip comma separator
      if (line[i] === ',') i++;
    } else if (line[i] === ',') {
      fields.push('');
      i++;
    } else {
      // Unquoted field
      let field = '';
      while (i < line.length && line[i] !== ',') {
        field += line[i++];
      }
      fields.push(field.trim());
      if (line[i] === ',') i++;
    }
  }
  return fields;
}

// ---------------------------------------------------------------------------
// parseChecklistBowmanCsv  (Bowman / Topps positional CSV — no column headers)
//
// Format used by Bowman Chrome exports from xlsx:
//   Base Set,,,              ← section title (col 0 only)
//   ,,,                      ← empty separator
//   100 cards,,,             ← metadata, skip
//   1,Jacob Wilson,Athletics,RC   ← data: [card_num, player, team, flag?]
//   BCP-153,Josuar Gonzalez,San Francisco Giants   ← code-based card num
// ---------------------------------------------------------------------------
function parseChecklistBowmanCsv(text: string): ParsedChecklist {
  const rawLines = text.split('\n');
  const sections: ParsedSection[] = [];
  let currentSection: ParsedSection | null = null;
  let productName = '';
  let pendingHeader: string | null = null;

  for (const rawLine of rawLines) {
    if (!rawLine.trim()) continue;

    const fields = parseCsvLine(rawLine);
    const col0 = fields[0]?.trim() ?? '';
    const col1 = fields[1]?.trim() ?? '';
    const col2 = fields[2]?.trim() ?? '';
    const col3 = fields[3]?.trim() ?? '';

    if (!col0 && !col1) continue;
    if (/^\d+\s+cards?$/i.test(col0) && !col1) continue;
    if (/subject to change/i.test(col0) && !col1) continue;

    // Card number: numeric ("1") or alphanumeric code ("BCP-153", "CPA-AC", "BA-1")
    const isCardNumber = /^\d+$/.test(col0) || /^[A-Z]{1,5}-[A-Z0-9]{1,5}$/.test(col0);

    if (isCardNumber && col1) {
      if (pendingHeader !== null) {
        if (currentSection && currentSection.cards.length > 0) sections.push(currentSection);
        currentSection = { sectionName: pendingHeader, cards: [], flagged: [] };
        pendingHeader = null;
      }
      if (!currentSection) currentSection = { sectionName: 'BASE', cards: [], flagged: [] };

      const isRookie = /^(RC|Rookie)$/i.test(col3);
      currentSection.cards.push({
        playerName: stripTrademarkSymbols(col1.replace(/,\s*$/, '')),
        team: col2 ? stripTrademarkSymbols(col2) : undefined,
        cardNumber: col0,
        isRookie,
        isSP: false,
        hasBackVariation: false,
        rawLine,
      });
    } else if (col0 && !col1) {
      if (!productName) productName = col0;
      pendingHeader = col0;
    }
  }

  if (currentSection && currentSection.cards.length > 0) sections.push(currentSection);
  return { productName, detectedFormat: 'generic', sections };
}

export function parseChecklistCsv(text: string): ParsedChecklist {
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) {
    return { productName: '', detectedFormat: 'panini-csv', sections: [] };
  }

  // Detect format: Panini/Donruss CSVs have column headers (ATHLETE, CARD SET, etc.)
  // Bowman-style CSVs have no header — first line is a section title or product name
  const firstRow = parseCsvLine(lines[0]);
  const hasPaniniHeader = firstRow.some(h =>
    ['ATHLETE', 'CARD SET', 'CARD NUMBER', 'SEQUENCE'].includes(h.replace(/"/g, '').toUpperCase())
  );
  if (!hasPaniniHeader) return parseChecklistBowmanCsv(text);

  // Parse header row
  const headerRow = parseCsvLine(lines[0]);
  const col = (name: string) => headerRow.findIndex(h => h.replace(/"/g, '').toUpperCase() === name.toUpperCase());

  const sportIdx     = col('SPORT');
  const yearIdx      = col('YEAR');
  const brandIdx     = col('BRAND');
  const cardSetIdx   = col('CARD SET');
  const athleteIdx   = col('ATHLETE');
  const teamIdx      = col('TEAM');
  const positionIdx  = col('POSITION');
  const cardNumIdx   = col('CARD NUMBER');
  const sequenceIdx  = col('SEQUENCE');
  const programIdx   = col('PROGRAM');

  // Derive product name from first data row (YEAR + BRAND)
  let productName = '';

  // Group by CARD SET
  const sectionMap = new Map<string, ParsedSection>();
  const sectionOrder: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = parseCsvLine(line);
    const get = (idx: number) => (idx >= 0 && idx < fields.length ? fields[idx].trim() : '');

    const cardSet  = get(cardSetIdx) || 'Unknown Set';
    const athlete  = get(athleteIdx);
    const team     = get(teamIdx);
    const cardNum  = get(cardNumIdx);
    const seqRaw   = get(sequenceIdx);
    const year     = get(yearIdx);
    const brand    = get(brandIdx);

    if (!athlete) continue; // skip empty athlete rows

    // Build product name from first row
    if (!productName && year && brand) {
      productName = `${year} ${brand}`;
    }

    // Determine print run
    const printRun = seqRaw && /^\d+$/.test(seqRaw) ? parseInt(seqRaw, 10) : undefined;

    const card: ParsedCard = {
      playerName: athlete,
      team: team || undefined,
      cardNumber: cardNum || undefined,
      isRookie: false,
      isSP: false,
      hasBackVariation: false,
      printRun,
      rawLine: line,
    };

    if (!sectionMap.has(cardSet)) {
      sectionMap.set(cardSet, { sectionName: cardSet, cards: [], flagged: [] });
      sectionOrder.push(cardSet);
    }
    sectionMap.get(cardSet)!.cards.push(card);
  }

  const sections = sectionOrder.map(name => sectionMap.get(name)!);

  return { productName, detectedFormat: 'panini-csv', sections };
}

// ---------------------------------------------------------------------------
// parseOddsPdf  (Topps odds sheet)
//
// Lines look like:
//   "Base Common          1:8     "
//   "Base Common Refractor   1:24   1:12"
//   "Rookie Auto Refractor /299  1:350  1:175"
//
// Strategy:
//   - Find all tokens matching 1:\d+
//   - Everything before the first 1:\d+ token is the subset name
//   - First 1:\d+ = hobby odds
//   - Second 1:\d+ (if present) = breaker odds
// ---------------------------------------------------------------------------
// Matches an N:M ratio with optional space + thousands separators.
// Captures both numerator and denominator so we can detect both
// `1:N` (1 in N — most odds) and `N:1` (N per 1 — Base in Cosmic Chrome 2025-26
// is "3:1", meaning 3 base cards per box). We normalize both into a hobby_odds
// number that the engine consumes as `1/hobby_odds = pull rate per box`.
const ODDS_RATIO_RE = /(\d+):\s*([\d,]+)/g;

function normalizeOddsRatio(num: string, den: string): string | null {
  const n = parseInt(num.replace(/,/g, ''), 10);
  const d = parseInt(den.replace(/,/g, ''), 10);
  if (!Number.isFinite(n) || !Number.isFinite(d) || n <= 0 || d <= 0) return null;
  if (n === 1) return String(d); // standard 1:N form — store the denominator
  if (d === 1) return (1 / n).toFixed(4); // N:1 form (multiple per box) — store as fractional
  return null; // some other ratio we don't know how to interpret
}

export function parseOddsPdf(text: string): ParsedOdds {
  const lines = text.split('\n');
  const rows: ParsedOdds['rows'] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const matches = [...trimmed.matchAll(ODDS_RATIO_RE)];
    if (matches.length === 0) continue;

    const firstMatchIdx = matches[0].index!;
    const subsetName = trimmed.slice(0, firstMatchIdx).trim();

    if (!subsetName) continue; // odds with no label — skip

    const hobbyOdds = normalizeOddsRatio(matches[0][1], matches[0][2]);
    if (!hobbyOdds) continue; // unparseable ratio
    const breakerOdds = matches.length >= 2
      ? normalizeOddsRatio(matches[1][1], matches[1][2])
      : null;

    rows.push({ subsetName, hobbyOdds, breakerOdds });
  }

  return { rows };
}

// ---------------------------------------------------------------------------
// parseChecklistXlsx  (Bowman-style XLSX format)
// ---------------------------------------------------------------------------
// Each relevant sheet becomes a section. Row format:
//   [card_number_or_code, "Player Name,", "Team or College", optional "RC"]
// Sheets skipped: Full Checklist, NBA Teams, College Teams (aggregates/indexes)
// ---------------------------------------------------------------------------

const XLSX_SKIP_SHEETS = new Set(['Full Checklist', 'NBA Teams', 'College Teams', 'Teams', 'MLB Teams', 'Topps Master Checklist']);

// Labels that are structural, not parallel names — ignore as section/parallel names
// but still use as a signal that we're in the parallels block.
const STRUCTURAL_LABEL_RE = /^(Parallels?|Base\s*(Set|Cards?)?|Paralles|Breaker'?s\s+Delight.*|\d+\s+per\s+(hobby|breaker'?s?\s+delight)\s+box|Common:\s+#.*|Uncommon:\s+#.*|Rare:\s+#.*|Short\s+Print:\s+#.*)$/i;

// Detects "<label> /<number>" (a parallel with print run) or bare parallel labels
// like "Refractor", "Superfractor", "Gold", "Gold Geometric", "Red/Black Geometric".
// Also matches labels without print runs ("Refractor", "Geometric", "Oil Spill").
const PARALLEL_LABEL_RE = /\/\d+\s*$/;

// ---------------------------------------------------------------------------
// parseChecklistXlsx  (Bowman/Topps XLSX format with parallel expansion)
//
// Sheet layout is a repeating block:
//   <Section Name>             ← e.g. "Finest Autographs", "Base - Common"
//   (blank)
//   "<N> cards"                ← metadata row, ignored
//   "Parallels"                ← structural label
//   (blank)
//   <parallel1>                ← e.g. "Refractor", "Gold /50", "SuperFractor /1"
//   <parallel2>
//   ...
//   (blank)
//   <card_num>, <player>, <team>, [flag]   ← data rows
//   ...
//
// The old parser collapsed every label-only row into `currentSectionName`, so each
// card only got ONE variant row — the label of the LAST label-only row before it.
// That meant every Topps Finest card came out as variant="SuperFractor /1" (or
// "Red Geometric /5" when a subset had no SuperFractor).
//
// The fix: track base section name and collected parallels separately. When a data
// block starts, emit one card per parallel in the block (plus one "Base" row if the
// block had no Refractor/Base listing — Topps always has an implicit Base).
// ---------------------------------------------------------------------------

function isParallelLabel(label: string): boolean {
  // Print-run form: "Gold /50", "SuperFractor /1"
  if (PARALLEL_LABEL_RE.test(label)) return true;
  // Plain parallels commonly seen in Topps Finest checklists.
  return /^(Refractor|X-Fractor|Superfractor|Geometric|Oil\s*Spill|Die[-\s]?Cut|Black|Red|Blue|Green|Gold|Orange|Purple|Yellow|Sky\s*Blue)(\s+.+)?$/i.test(label);
}

export function parseChecklistXlsx(buffer: Buffer): ParsedChecklist {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require('xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer' });

  // Each base-section header starts its own ParsedSection. Cards inside carry
  // their own `parallels` list; the importer turns those into variant rows.
  const sectionMap = new Map<string, ParsedSection>();
  const sectionOrder: string[] = [];

  const getSection = (name: string): ParsedSection => {
    let s = sectionMap.get(name);
    if (!s) {
      s = { sectionName: name, cards: [], flagged: [] };
      sectionMap.set(name, s);
      sectionOrder.push(name);
    }
    return s;
  };

  for (const sheetName of wb.SheetNames) {
    if (XLSX_SKIP_SHEETS.has(sheetName)) continue;

    const ws = wb.Sheets[sheetName];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

    // Per-sheet block state.
    let baseSection = sheetName;
    let parallels: string[] = [];
    let sawDataInBlock = false;

    for (const row of rows) {
      if (!Array.isArray(row) || row.length === 0) continue;

      const c0 = row[0];
      const c1 = row[1];

      const isLabelOnly =
        typeof c0 === 'string' &&
        c0.trim().length > 0 &&
        (c1 === undefined || c1 === null || (typeof c1 === 'string' && c1.trim() === ''));

      if (isLabelOnly) {
        const label = (c0 as string).trim();

        if (/^\d+ cards?$/i.test(label)) continue;
        if (STRUCTURAL_LABEL_RE.test(label)) continue;

        if (isParallelLabel(label)) {
          // A parallel label after a block's data rows signals a new sub-block
          // of the same base section (shouldn't normally happen, but be safe).
          if (sawDataInBlock) {
            parallels = [];
            sawDataInBlock = false;
          }
          parallels.push(label);
          continue;
        }

        // Non-parallel label → new base section header. Reset parallels.
        baseSection = label;
        parallels = [];
        sawDataInBlock = false;
        continue;
      }

      // Data row.
      //
      // Bowman autograph subsets ("Under The Radar Autographs", "Power Chords
      // Autographs", etc.) use a parallel-prefix layout that diverges from the
      // standard:
      //
      //   [parallel_label, card_num, player, team, flag?]
      //   "Base",                      1, "Aaron Judge,", "USA"
      //   "Base - Etched In Glass...", 1, "Aaron Judge,", "USA"
      //   "Refractor /50",             1, "Aaron Judge,", "USA"
      //
      // The standard layout has card_num in c0 with parallels carried over from
      // prior label-only rows. To keep both working we sniff c0: if it looks
      // like a parallel label (Refractor / Gold /50 / etc.) OR starts with
      // "Base" — and c1 has content — we shift columns and treat c0 as a
      // per-row parallel.
      const c0Str = c0 != null ? String(c0).trim() : '';
      const c1HasContent = c1 != null && String(c1).trim().length > 0;
      const c0IsParallelPrefix =
        c0Str.length > 0 &&
        c1HasContent &&
        (isParallelLabel(c0Str) || /^Base($|\s|-)/i.test(c0Str));

      let cardNumber: string;
      let rawName: string;
      let team: string | undefined;
      let flag: string;
      let rowParallels: string[];

      if (c0IsParallelPrefix) {
        cardNumber = c1 != null ? String(c1).trim() : '';
        rawName = row[2] != null ? String(row[2]).trim() : '';
        team = row[3] != null ? String(row[3]).trim().replace(/,\s*$/, '') || undefined : undefined;
        flag = row[4] != null ? String(row[4]).trim() : '';
        rowParallels = [c0Str];
      } else {
        cardNumber = c0Str;
        rawName = c1 != null ? String(c1).trim() : '';
        team = row[2] != null ? String(row[2]).trim().replace(/,\s*$/, '') || undefined : undefined;
        flag = row[3] != null ? String(row[3]).trim() : '';
        rowParallels = parallels.slice();
      }

      if (!rawName) continue;

      const playerName = stripTrademarkSymbols(rawName.replace(/,\s*$/, ''));
      const isRookie = flag === 'RC';

      getSection(baseSection).cards.push({
        playerName,
        team,
        cardNumber: cardNumber || undefined,
        isRookie,
        isSP: false,
        hasBackVariation: false,
        rawLine: row.join('\t'),
        parallels: rowParallels,
      });
      sawDataInBlock = true;
    }
  }

  const sections = sectionOrder.map(n => sectionMap.get(n)!);
  return { productName: '', detectedFormat: 'generic', sections };
}
