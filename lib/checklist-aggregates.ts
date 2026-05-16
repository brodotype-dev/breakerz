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
// 2. Card-subset codes ("B25-AL", "TC25-CS", "BCP-LP" — Bowman's Best
//    autograph subset prefixes, Topps Chrome insert codes, etc.).
//    Pattern: 1-3 letter prefix + optional 1-2 digit year + dash + 1-6
//    letter suffix. These appear when a Topps XLSX/PDF lists subsets as
//    rows with just the SKU code and no real player name. Conservative
//    enough to never match real names (no real player has a "-"
//    sandwiched between short caps groups).
//
// Both server (import-checklist route) and client (admin views) need
// this; centralized here so the rule stays in one place.
const CARD_SUBSET_CODE_RE = /^[A-Z]{1,3}\d{0,2}-[A-Z]{1,6}$/;

export function isMultiPlayerName(name: string): boolean {
  if (name.includes('/')) return true;
  if (CARD_SUBSET_CODE_RE.test(name.trim())) return true;
  return false;
}
