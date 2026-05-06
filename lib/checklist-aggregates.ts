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

// Multi-player rows ("Skubal / Blanco / Valdez" — League Leaders, dual
// autographs) are subset cards, not real player entities. Detected by a "/"
// in the name. Both server and client need this; centralized here so the
// rule stays in one place.
export function isMultiPlayerName(name: string): boolean {
  return name.includes('/');
}
