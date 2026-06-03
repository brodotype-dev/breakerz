// Shared player-aggregate computation for the checklist import flow.
//
// The server's POST /api/admin/import-checklist computes these aggregates
// from the full sections array in a single request. When the import is too
// large for Vercel's 4.5 MB Function ingress, the client splits the cards
// across multiple requests — but the player + player_product upserts have
// to be invariant across batches (`hobby_sets` / `bd_only_sets` are sums,
// not values that should change per batch).
//
// To make that work, the client computes these aggregates ONCE locally over
// the full dataset, then sends them with every chunk as `playersOverride`.
// The server uses the override directly when present and skips its own
// per-section accumulation. This file is the single source of truth for the
// aggregation logic.

import type { ParsedCard } from './checklist-parser';

export type SectionInput = {
  sectionName: string;
  hobbySets: number;
  bdSets: number;
  cards: ParsedCard[];
};

export type PlayerAggregate = {
  name: string;
  team: string;
  hobbySets: number;
  bdSets: number;
  isRookie: boolean;
  hasBaseAppearance: boolean;
  // Union of every card_number this player appears under, across all sections.
  // Persisted on player_products.checklist_card_numbers so the hydrate flow
  // can scope CH variant attachment to what's actually in this product.
  cardNumbers: string[];
};

const isBaseShapedCardNumber = (n: string | undefined): boolean => {
  if (!n) return false;
  return /^(?:[A-Z]+-)?\d+$/.test(n);
};

const isBaseSectionName = (name: string): boolean => {
  if (/autograph/i.test(name)) return false;
  if (/variation/i.test(name)) return false;
  return /^(Base($|\s|-)|Chrome\s+Prospects?($|\s|-))/i.test(name);
};

export function computePlayerAggregates(sections: SectionInput[]): PlayerAggregate[] {
  // Per-(name, team) accumulator for hobby_sets / bd_sets. A player can
  // appear under different teams across sections (rare; typically empty
  // string vs. populated). The Set-totals key uses both fields; the final
  // dedupe-by-name pass below keeps the most populated team string.
  const playerSetTotals = new Map<string, {
    name: string; team: string; hobbySets: number; bdSets: number; isRookie: boolean;
  }>();
  const playerHasBaseAppearance = new Map<string, boolean>();
  const playerCardNumbers = new Map<string, Set<string>>();

  for (const section of sections) {
    for (const card of section.cards) {
      const key = `${card.playerName}||${card.team ?? ''}`;
      const existing = playerSetTotals.get(key);
      playerSetTotals.set(key, {
        name: card.playerName,
        team: card.team ?? existing?.team ?? '',
        hobbySets: (existing?.hobbySets ?? 0) + section.hobbySets,
        bdSets: (existing?.bdSets ?? 0) + section.bdSets,
        isRookie: card.isRookie || (existing?.isRookie ?? false),
      });

      const isBaseCard = isBaseShapedCardNumber(card.cardNumber) && isBaseSectionName(section.sectionName);
      if (isBaseCard) playerHasBaseAppearance.set(card.playerName, true);
      else if (!playerHasBaseAppearance.has(card.playerName)) {
        playerHasBaseAppearance.set(card.playerName, false);
      }

      if (card.cardNumber) {
        const nums = playerCardNumbers.get(card.playerName) ?? new Set<string>();
        nums.add(card.cardNumber);
        playerCardNumbers.set(card.playerName, nums);
      }
    }
  }

  // Dedupe by name across (name, team) keys — same player with empty vs.
  // populated team merges into the most-complete record.
  const playersByName = new Map<string, PlayerAggregate>();
  for (const p of playerSetTotals.values()) {
    const existing = playersByName.get(p.name);
    playersByName.set(p.name, {
      name: p.name,
      team: p.team || existing?.team || '',
      hobbySets: (existing?.hobbySets ?? 0) + p.hobbySets,
      bdSets: (existing?.bdSets ?? 0) + p.bdSets,
      isRookie: p.isRookie || (existing?.isRookie ?? false),
      hasBaseAppearance: playerHasBaseAppearance.get(p.name) === true,
      cardNumbers: Array.from(playerCardNumbers.get(p.name) ?? []),
    });
  }

  return Array.from(playersByName.values());
}

// Detect rows that are NOT real player entities and should be flagged
// `insert_only=true` (excluded from team filters + slot pricing).
//
// Two patterns covered:
//
// 1. Multi-player rows ("Skubal / Blanco / Valdez" — League Leaders,
//    dual autographs) — detected by a "/" in the name.
//
// 2. Card-subset codes — short SKU codes that crept into the players
//    table because a Topps XLSX/PDF listed subset rows with just the
//    code and no real player name. Cover three shapes:
//      · "B25-AL", "TC25-CS"   → letters + optional year + dash + letters
//      · "90A-KS"              → digits + letters + dash + letters
//      · "3D-37", "BCP-37"     → mixed/short + dash + digits
//    Generalized as: ≤5 uppercase-alphanumeric chars + dash + ≤6
//    uppercase-alphanumeric chars, no spaces. Safe regex — no real
//    player name fits the "all-caps, no spaces, single hyphen, short"
//    profile (real hyphenated names are mixed case and longer).
//
// Both server (import-checklist route) and client (parser roster
// filter) need this; centralized here so the rule stays in one place.
//
// Widened 2026-06-03 from {1,5}-{1,6} to {1,6}-{1,8}: real subsets ship
// 6-char prefixes (MLMDA2, HLAR2, TFAP2, …) and longer suffixes that the
// tighter bound let slip into the players table as fake "players".
const CARD_SUBSET_CODE_RE = /^[A-Z0-9]{1,6}-[A-Z0-9]{1,8}$/;

export function isMultiPlayerName(name: string): boolean {
  if (name.includes('/')) return true;
  if (CARD_SUBSET_CODE_RE.test(name.trim())) return true;
  return false;
}

/**
 * Exported for the parser roster filter — same regex, but as a standalone
 * predicate so the parser doesn't pull in the slash check (that's a
 * different signal that the parser already handles via prompt rules).
 */
export function isCardSubsetCode(name: string): boolean {
  return CARD_SUBSET_CODE_RE.test(name.trim());
}

/**
 * Broad "is this a real player name?" test for surfaces that list raw rows
 * from the players table (e.g. the /admin/players directory). A real name
 * always carries a space (first + last) OR a lowercase letter (mononyms like
 * "Ichiro"). Card codes and stray card numbers — "90CAS-DO", "MLMDA2-X",
 * "221", "B25-ÉP" — have neither, so this catches dash codes, pure-numeric
 * names, and accented codes the CARD_SUBSET_CODE_RE (ASCII-only) misses.
 * Intentionally inclusive: when in doubt, keep the row.
 */
export function looksLikeRealPlayerName(name: string): boolean {
  const n = (name ?? '').trim();
  if (!n) return false;
  return /\s/.test(n) || /[a-z]/.test(n);
}
