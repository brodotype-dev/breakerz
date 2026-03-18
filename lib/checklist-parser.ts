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

function parseNumberedLine(line: string): ParsedCard | null {
  const m = line.match(NUMBERED_LINE_RE);
  if (!m) return null;

  const cardNumber = m[1].trim();
  const playerName = m[2].trim();
  const isSP = m[3] === '*';
  const team = stripTrademarkSymbols(m[4].trim());
  const isRookie = !!m[5];
  const hasBackVariation = !!m[6];

  return { playerName, team, cardNumber, isRookie, isSP, hasBackVariation, rawLine: line };
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

function parseCodeLine(line: string): ParsedCard | null {
  const m = line.match(CODE_LINE_RE) ?? line.match(CODE_LINE_LOOSE_RE);
  if (!m) return null;

  const cardNumber = m[1].trim();
  const playerName = m[2].trim();
  const team = stripTrademarkSymbols(m[3].trim());

  return {
    playerName,
    team,
    cardNumber,
    isRookie: false,   // code-based sets don't typically mark rookie in-line
    isSP: false,
    hasBackVariation: false,
    rawLine: line,
  };
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

  const parseLine = format === 'topps-pdf-numbered' ? parseNumberedLine : parseCodeLine;

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
      const card = parseLine(line);
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

export function parseChecklistCsv(text: string): ParsedChecklist {
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) {
    return { productName: '', detectedFormat: 'panini-csv', sections: [] };
  }

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
const ODDS_TOKEN_RE = /1:\d+/g;

export function parseOddsPdf(text: string): ParsedOdds {
  const lines = text.split('\n');
  const rows: ParsedOdds['rows'] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const matches = [...trimmed.matchAll(ODDS_TOKEN_RE)];
    if (matches.length === 0) continue;

    const firstMatchIdx = matches[0].index!;
    const subsetName = trimmed.slice(0, firstMatchIdx).trim();

    if (!subsetName) continue; // odds with no label — skip

    const hobbyOdds = matches[0][0];
    const breakerOdds = matches.length >= 2 ? matches[1][0] : null;

    rows.push({ subsetName, hobbyOdds, breakerOdds });
  }

  return { rows };
}
