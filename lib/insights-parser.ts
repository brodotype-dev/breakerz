/**
 * Multi-output Claude parser for market insights captured via Discord.
 *
 * Today's BreakIQ Insights debrief parser only emits player-sentiment scores. This
 * extends the schema to four update types — sentiment, asking-price,
 * hype-tag, risk-flag — so a single narrative ("Flagg PYP is 12-15k on
 * streams, Wemby is hurt, Bowman Concan crystallized cooled off") can
 * produce all four with one Claude call.
 *
 * Each parsed update is staged into `pending_insights` first, then a
 * human ✅ confirmation applies it to the appropriate backing table.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { isCardSubsetCode } from '@/lib/checklist-aggregates';
import type { SlotComposition, AskingPriceSource, BreakFormat } from '@/lib/types';

// Re-export so existing imports of AskingPriceSource from this module
// keep working without an external rename. Canonical home is lib/types.ts.
export type { AskingPriceSource } from '@/lib/types';

// Validate a parser-emitted composition map. At least one valid format key,
// values must be null or a positive integer ≤ 50 (sanity bound). Returns
// `{ ok, comp }` on success or `{ ok: false, reason }` on validation
// failure. Used by both parseInsights and parseBreakPrice.
export function validateComposition(
  input: unknown,
): { ok: true; comp: SlotComposition } | { ok: false; reason: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: 'composition not an object' };
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0) {
    return { ok: false, reason: 'composition empty' };
  }
  const out: SlotComposition = {};
  const validKeys: BreakFormat[] = ['hobby', 'bd', 'jumbo'];
  for (const [key, value] of entries) {
    if (!validKeys.includes(key as BreakFormat)) {
      return { ok: false, reason: `composition has unknown key ${key}` };
    }
    if (value === null || value === undefined) {
      out[key as BreakFormat] = null;
    } else {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0 || n > 50) {
        return { ok: false, reason: `composition ${key} value out of bounds: ${value}` };
      }
      out[key as BreakFormat] = Math.round(n);
    }
  }
  return { ok: true, comp: out };
}

// Render a composition into a short human label for proposal previews
// and admin chips.
//   { hobby: null }                  → "hobby"
//   { hobby: 3 }                     → "hobby ×3"
//   { bd: 20, hobby: 5 }             → "bd 20 + hobby 5"
//   { bd: null, hobby: null }        → "bd + hobby"
//   { jumbo: null, bd: 2, hobby: 5 } → "bd 2 + hobby 5 + jumbo" (canonical key order)
export function renderComposition(comp: SlotComposition): string {
  const ORDER: BreakFormat[] = ['hobby', 'bd', 'jumbo'];
  const presentKeys = ORDER.filter(k => comp[k] !== undefined);
  if (presentKeys.length === 0) return '?';

  // Single-key shortcut — most common case.
  if (presentKeys.length === 1) {
    const k = presentKeys[0];
    const v = comp[k];
    return v == null ? k : `${k} ×${v}`;
  }

  // Multi-key: render each segment with or without its count, join with ' + '.
  // If at least one segment has a numeric count, we still render the null
  // segments as bare-key (no count) so the asymmetry is preserved.
  return presentKeys
    .map(k => {
      const v = comp[k];
      return v == null ? k : `${k} ${v}`;
    })
    .join(' + ');
}

export type ParsedUpdate =
  | {
      kind: 'sentiment';
      player_id: string;
      player_name: string;
      // 'global' applies to every player_product for this player (today's
      // default behavior). 'product' applies only to the (player, product)
      // pair — for narrative like "Wemby in 2024 Topps Chrome is going wild"
      // where the read is product-specific and should not bleed across SKUs.
      scope: 'global' | 'product';
      product_id?: string;       // required when scope='product'
      score: number;            // -0.5..0.5, snaps to 0.25 increments client-side
      note: string;
      confidence: number;
    }
  | {
      kind: 'asking_price';
      product_id: string;
      product_name: string;
      // 'variant' is variant-specific ("Ohtani orange ref listed at $3.5k").
      // variant_name is free-text — variant_id resolution is deferred until
      // the engine starts reading variant-scope observations (Phase 3).
      scope_type: 'team' | 'player' | 'product' | 'variant';
      scope_team?: string;       // when scope_type='team'
      scope_player_id?: string;  // when scope_type='player' OR 'variant' (variant rolls up to player)
      variant_name?: string;     // when scope_type='variant'
      // Slot composition. Single-key with null value = pure-format slot,
      // ratio not specified. Multi-key = mixed bundle. See SlotComposition
      // in lib/types.ts for the full rules.
      composition: SlotComposition;
      price_low: number;
      price_high: number;
      source: AskingPriceSource;
      source_note: string;
      confidence: number;
    }
  | {
      kind: 'hype_tag';
      product_id: string;
      product_name: string;
      scope_type: 'team' | 'player' | 'product' | 'variant';
      scope_team?: string;
      scope_player_id?: string;  // when 'player' OR 'variant'
      variant_name?: string;     // when scope_type='variant'
      tag: 'release_premium' | 'cooled' | 'overhyped' | 'underhyped';
      strength: number;          // 0..1
      decay_days: number;
      source_note: string;
      confidence: number;
    }
  | {
      kind: 'risk_flag';
      player_id: string;
      player_name: string;
      flag_type: 'injury' | 'suspension' | 'legal' | 'trade' | 'retirement' | 'off_field';
      note: string;
      confidence: number;
    }
  | {
      // Field intel: a specific card pulls at a different rate than the
      // odds sheet says. Variant-level by nature. Composition captures the
      // case mix the contributor was observing when they reported the rate
      // — "1:80 hobby" → {hobby: null}, "1:80 across a bd+hobby mix" →
      // {bd: null, hobby: null}. observed_odds_per_case is "1 in N cases".
      kind: 'odds_observation';
      product_id: string;
      product_name: string;
      scope_type: 'variant' | 'player';
      scope_player_id?: string;  // always set (variant rolls up to player too)
      variant_name?: string;     // when scope_type='variant'
      composition: SlotComposition;
      observed_odds_per_case: number;  // e.g. 80 for "1 in 80 cases"
      source: AskingPriceSource;
      source_note: string;
      confidence: number;
    }
  | {
      // Track B (Phase 2): cascading sentiment about a team across all products.
      // "Royals are stacked this year" — applies to every Royals player_product
      // in every product they appear in. Capped at ±0.20 contribution per the
      // engine's per-scope ladder.
      kind: 'team_sentiment';
      team_name: string;        // canonical team string (must match players.team)
      direction: 1 | -1;
      strength: number;         // 0..1
      decay_days: number;       // 14..60
      tag?: string;             // optional free-text label like "stacked_roster"
      source_note: string;
      confidence: number;
    }
  | {
      // Track B: sentiment about a whole product. "2026 Bowman is the loaded
      // class" — applies to every player in that product. Capped at ±0.15.
      kind: 'product_sentiment';
      product_id: string;
      product_name: string;
      direction: 1 | -1;
      strength: number;
      decay_days: number;
      tag?: string;
      source_note: string;
      confidence: number;
    }
  | {
      // Track B: team × product intersection — the most specific cascade
      // scope. "Pirates in 2026 Bowman are loaded" only nudges Pirates
      // players in that one product. Capped at ±0.25 (more than team alone
      // because the intersection is narrower).
      kind: 'team_product_sentiment';
      team_name: string;
      product_id: string;
      product_name: string;
      direction: 1 | -1;
      strength: number;
      decay_days: number;
      tag?: string;
      source_note: string;
      confidence: number;
    };

export interface ParseInput {
  /**
   * Free-form market debrief. Optional only when at least one image is
   * supplied — the parser short-circuits with an empty result when both
   * narrative and images are absent.
   */
  narrative?: string;
  /**
   * Optional screenshots (stream overlays, tweets, IG posts, chat caps,
   * news clippings). When set and non-empty, each image is sent to Claude
   * as a content block in supplied order alongside the text prompt.
   * Mirrors the path parseBreakPrice has used since 2026-05-13 — same
   * BreakPriceImage type to keep the route handlers cookie-cutter.
   */
  images?: BreakPriceImage[];
  /**
   * Optional contributor context — "this is from Kyle's stream" /
   * "screenshot is a DM, not a public post". Rendered as supplementary
   * context, NOT as authoritative override. For refine-time corrections
   * use `refineCorrection` instead.
   */
  notes?: string;
  // Soft cap on roster size sent to Claude. The full prod catalog is ~3k
  // players which fits easily in Haiku's 200k context (~75k tokens worth).
  // We cap at 5000 as a guard against future growth, and prefer
  // slot-eligible players (insert_only=false) — multi-player insert rows
  // and retired-legend subset cards aren't real targets for sentiment.
  maxPlayers?: number;
  // Authoritative correction supplied by the contributor via the
  // refine flow. When present we render it in a dedicated section of
  // the prompt and tell the model it OVERRIDES any conflicting
  // interpretation of the narrative. Previously the refine handler
  // just concatenated this onto the narrative, which let the model
  // re-roll wrong (Wemby insight got re-mapped to Alex Sarr after
  // a refine that literally said "Victor Webanyama - not Donic").
  refineCorrection?: string;
}

export interface ParseResult {
  updates: ParsedUpdate[];
  /** Diagnostic info attached to every result so we can debug 0-update returns
   * without log spelunking. The bot reply surfaces this when updates is empty. */
  debug: {
    rosterSize: number;
    productsCount: number;
    rawResponseExcerpt: string;
    parsedRawCount: number;
    droppedReasons: string[];
    hadImage: boolean;
    hadNarrative: boolean;
  };
}

export async function parseInsights({
  narrative,
  images,
  notes,
  maxPlayers = 5000,
  refineCorrection,
}: ParseInput): Promise<ParseResult> {
  const narrativeText = narrative?.trim() ?? '';
  const imageList = images ?? [];
  const hadNarrative = narrativeText.length > 0;
  const hadImage = imageList.length > 0;

  if (!hadNarrative && !hadImage) {
    return {
      updates: [],
      debug: {
        rosterSize: 0,
        productsCount: 0,
        rawResponseExcerpt: 'no input',
        parsedRawCount: 0,
        droppedReasons: [],
        hadImage,
        hadNarrative,
      },
    };
  }

  // Roster = TWO tiers:
  //
  // PRIMARY (active-tier): every solo player appearing in an active product
  // (live or pre_release). Valid match candidates for every update kind.
  // ~2,900 players as of 2026-05-26.
  //
  // SECONDARY (risk-only tier): every other solo player in the `players`
  // table with at least one player_product row (regardless of product
  // active status). Valid match candidates for RISK_FLAG ONLY. We added
  // this 2026-05-26 after Brandon Marsh (Phillies OF, not on any active
  // Bowman product) couldn't be flagged with a hand injury — he WILL
  // appear on a future Topps Flagship onboarding, so capturing his risk
  // event today and keeping the record longitudinal is worth the prompt
  // budget. The original active-only scope was too narrow for risk_flag
  // specifically — risk flags are leading indicators and orphaned-from-
  // product capture is still valuable.
  //
  // Why two tiers and not one big roster: bringing the full ~6,666-player
  // table back as the primary roster reintroduced the Wemby cap bug
  // (#142) — alphabetical capping at 5,000 was dropping V/W region. By
  // capping primary first and filling secondary to the remaining budget,
  // we keep every active player findable and add as many risk-only
  // candidates as fit.
  //
  // Multi-player concatenated rows ("Skubal / Blanco") and card-subset
  // codes ("3D-37", "B25-AL") still excluded in BOTH tiers.
  const { data: products, error: prodErr } = await supabaseAdmin
    .from('products')
    .select('id, name, year, lifecycle_status')
    .eq('is_active', true)
    .in('lifecycle_status', ['live', 'pre_release']);

  if (prodErr) {
    console.error('[insights-parser] products query failed:', prodErr);
    return {
      updates: [],
      debug: { rosterSize: 0, productsCount: 0, rawResponseExcerpt: `products query: ${prodErr.message}`, parsedRawCount: 0, droppedReasons: [], hadImage, hadNarrative },
    };
  }

  type RosterPlayer = { id: string; name: string; team: string; sport: { name: string } | null; tier: 'active' | 'risk_only' };
  let players: RosterPlayer[] = [];
  const activeIds = new Set<string>();
  {
    // PRIMARY tier — page through active-product players. Same inner-join
    // gate as before #149.
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error: plErr } = await supabaseAdmin
        .from('players')
        .select('id, name, team, sport:sports(name), player_products!inner(products!inner(is_active))')
        .eq('player_products.products.is_active', true)
        .not('name', 'like', '%/%')
        .order('name')
        .range(from, from + PAGE - 1);
      if (plErr) {
        console.error('[insights-parser] players (active) query failed:', plErr);
        break;
      }
      if (!data || data.length === 0) break;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const row of data as any[]) {
        if (activeIds.has(row.id)) continue;
        activeIds.add(row.id);
        const sportObj = Array.isArray(row.sport) ? (row.sport[0] ?? null) : (row.sport ?? null);
        players.push({ id: row.id, name: row.name, team: row.team, sport: sportObj, tier: 'active' });
      }
      if (data.length < PAGE || players.length >= maxPlayers) break;
    }
    players = players.filter(p => !isCardSubsetCode(p.name));
  }

  // SECONDARY tier — fill remaining roster budget with any-product players
  // not already in primary. Inner-join on player_products only (no active
  // filter), exclude IDs already captured. Cap to remaining budget so the
  // total roster stays within maxPlayers and prompt stays Haiku-safe.
  const remainingBudget = Math.max(0, maxPlayers - players.length);
  if (remainingBudget > 0) {
    const PAGE = 1000;
    const seenSecondary = new Set<string>();
    let added = 0;
    for (let from = 0; added < remainingBudget; from += PAGE) {
      const { data, error: plErr } = await supabaseAdmin
        .from('players')
        .select('id, name, team, sport:sports(name), player_products!inner(id)')
        .not('name', 'like', '%/%')
        .order('name')
        .range(from, from + PAGE - 1);
      if (plErr) {
        console.error('[insights-parser] players (risk-only) query failed:', plErr);
        break;
      }
      if (!data || data.length === 0) break;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const row of data as any[]) {
        if (activeIds.has(row.id)) continue; // already in primary
        if (seenSecondary.has(row.id)) continue;
        if (isCardSubsetCode(row.name)) continue;
        seenSecondary.add(row.id);
        const sportObj = Array.isArray(row.sport) ? (row.sport[0] ?? null) : (row.sport ?? null);
        players.push({ id: row.id, name: row.name, team: row.team, sport: sportObj, tier: 'risk_only' });
        added++;
        if (added >= remainingBudget) break;
      }
      if (data.length < PAGE) break;
    }
  }

  if (!products?.length || !players?.length) {
    return {
      updates: [],
      debug: {
        rosterSize: players?.length ?? 0,
        productsCount: products?.length ?? 0,
        rawResponseExcerpt: 'no roster fetched',
        parsedRawCount: 0,
        droppedReasons: [],
        hadImage,
        hadNarrative,
      },
    };
  }

  const productLines = products
    .map(p => `- ${p.year} ${p.name} [id: ${p.id}]`)
    .join('\n');
  const playerLines = players
    .map((p) => {
      const base = `- ${p.name} (${p.team || 'N/A'}, ${p.sport?.name ?? ''}) [id: ${p.id}]`;
      return p.tier === 'risk_only' ? `${base} *risk-only` : base;
    })
    .join('\n');
  const riskOnlyCount = players.filter(p => p.tier === 'risk_only').length;

  const prompt = `You are parsing a sports card market debrief into structured updates for BreakIQ.

Available products (use product ids exactly):
${productLines}

Available players (use player ids exactly):
${playerLines}
${riskOnlyCount > 0 ? `
TWO-TIER ROSTER:
- Default tier (no marker): the player is in at least one currently active product. Valid match candidate for EVERY update kind.
- \`*risk-only\` tier: the player has card history but is NOT in any currently active product. Valid match candidate for RISK_FLAG ONLY. For sentiment / asking_price / hype_tag / odds_observation / team_product_sentiment, OMIT updates targeting *risk-only players.

Why: risk flags are leading indicators (see RISK_FLAG rule below). We want event capture for players whose cards aren't currently in rotation but might be soon. The other update kinds need a current product_product row to land, so they stay scoped tight.
` : ''}

${hadImage ? `Screenshots: ${imageList.length} image${imageList.length === 1 ? '' : 's'} attached above this prompt. They may be stream overlays, tweets, IG / Discord screenshots, NEWS ARTICLES / EVENT REPORTS, chat captures — any source the contributor is using to feed BreakIQ. The contributor's act of capturing the screenshot is itself the signal that this is worth processing. Extract updates from text visible in the images using the per-kind rules below. When narrative and screenshots conflict on a detail, prefer the screenshot for prices / odds / proper nouns (it's the primary source) and the narrative for contributor-supplied context. All eight update kinds are fair game — pricing, sentiment, hype, RISK_FLAG, odds observations, and team/product takes. **Note the explicit RISK_FLAG rule below: news articles, official statements, and event reports about arrests / injuries / trades / suspensions / retirements ARE themselves the trigger — emit a risk_flag without requiring additional market reaction or breaker discussion in the screenshot.**
` : ''}${hadNarrative ? `Narrative:\n"""\n${narrativeText}\n"""` : 'No narrative provided — extract from the screenshot(s) only.'}
${notes?.trim() ? `
Contributor notes (supplementary context, NOT authoritative override):
"""
${notes.trim()}
"""
` : ''}${refineCorrection?.trim() ? `
CONTRIBUTOR CORRECTION (authoritative — overrides ANY conflicting interpretation of the narrative above):
"""
${refineCorrection.trim()}
"""

The contributor saw your prior attempt and is telling you what to fix. When the correction names a specific player, product, score, or scope, USE THAT — do not second-guess it. If the correction names a player by nickname or with a typo (e.g. "Webanyama" → "Victor Wembanyama"), match to the canonical roster entry. If you previously picked Player A and the correction says "this is for Player B," the answer is Player B and only Player B.
` : ''}
Extract zero or more updates. Each update is one of five kinds:

1. SENTIMENT — a player is hot/cold for non-obvious reasons (post-game buzz, injury return, etc.). Output:
   { "kind": "sentiment", "player_id": "...", "player_name": "...",
     "scope": "global" | "product",     // see scope rules below
     "product_id": "...",                // REQUIRED when scope='product'; MUST be an id from the products list above
     "score": 0.3, "note": "...", "confidence": 0.9 }
   score is -0.5 (very bearish) to +0.5 (very bullish).
   SCOPE RULES — STRONGLY DEFAULT TO 'global':
   - 'global' (DEFAULT) = applies to every product the player appears in. Use this whenever the narrative is about the PLAYER's market movement, performance, momentum, injury, or any general signal that would naturally affect ALL their cards. Examples: "Wemby is on a heater" / "Flagg's stock is up post-combine" / "Schwarber is moving on the home run pace" / "I just paid $335 for a 2014 Bowman Chrome auto, up from $200 two weeks ago — market is moving for him". A single-card sale or single-card price observation is NOT enough to warrant a narrower scope — that's market movement for the player.
   - 'product' = use ONLY when the narrative EXPLICITLY contrasts the player's value ACROSS products. The bar is high: "Wemby in 2024 Topps Chrome is going wild but his Bowman is cooling" / "Flagg's flagship Bowman is hotter than his Chrome". A narrative that simply mentions a single card does NOT meet this bar — that's still a global signal.
   - HARD RULES:
     · NEVER hallucinate a product_id. If you'd use scope='product' but the named product isn't in the products list above, fall back to scope='global'. Wrong product attribution is worse than missing data.
     · If the narrative is about a team's collective momentum ("Royals are stacked", "Tigers' farm is loaded"), use TEAM_SENTIMENT (kind 6) instead of sentiment.
     · A b-score / breakerz score adjustment is the same as sentiment. Same scope rules apply.

2. ASKING_PRICE — what streams or sellers are charging (NOT what's selling). Output:
   { "kind": "asking_price", "product_id": "...", "product_name": "...",
     "scope_type": "team" | "player" | "product" | "variant",
     "scope_team": "Dallas Mavericks",   // only when scope_type='team'
     "scope_player_id": "...",           // when scope_type='player' OR 'variant' (variants roll up to a player)
     "variant_name": "Orange Refractor /99",  // free-text variant description, only when scope_type='variant'
     "composition": { "hobby": null },   // SLOT COMPOSITION — see rules below
     "price_low": 12000, "price_high": 15000,
     "source": "ebay_listing" | "stream_ask" | "social_post" | "other",
     "source_note": "...", "confidence": 0.85 }
   If only one price was mentioned, set price_low=price_high.
   COMPOSITION RULES — emit a sparse map of formats involved per slot:
   - "$45 Diamondbacks" (no format mentioned on a hobby-only stream) → { "hobby": null }
   - "Bowman hobby per-team"                                          → { "hobby": null }
   - "Delight slot $300"                                              → { "bd": null }
   - "Jumbo per-team $800"                                            → { "jumbo": null }
   - "Delight/hobby — 20 delight 5 hobby per break/slot"              → { "bd": 20, "hobby": 5 }
   - "Mixed delight + hobby" (no per-slot ratio)                      → { "bd": null, "hobby": null }
   Rules:
   - Single-key with null value = "this format, count not specified" (the common case)
   - Multi-key = the slot covers a bundled mix of formats
   - null values mean "this format involved, ratio unknown"
   - Numeric values mean "case count per slot, explicitly stated by the source"
   - Never emit a "mixed" key — express mixing by including multiple keys
   - Use "bd" for "delight" / "BD" / "breaker's delight"
   PRICE RULES:
   - Use the LITERAL dollar amount as written. "$700.00" = 700, not 700000. "$1,200" = 1200. "$3.5k" = 3500. "$12k–$15k" = 12000–15000.
   - The "." in "$700.00" is a decimal point (cents). Round to whole dollars: "$700.00" → 700, "$699.99" → 700.
   - DO NOT scale a price up because it seems low for the card. Capture exactly what was said. A buddy-deal or undervalue is itself the signal we want to record.
   SOURCE RULES:
   - 'ebay_listing' = unsold eBay listing (asking price on a live listing). This is the leading-indicator signal — CardHedger only sees sold comps, so eBay listings during the first few days of a release are critical intel we can't get elsewhere.
   - 'stream_ask' = what a breaker is charging on a live break (Whatnot/Fanatics Live/etc.).
   - 'social_post' = a price mentioned in a tweet, IG post, Discord message, etc.
   - 'other' = anywhere else.

3. HYPE_TAG — a temporary premium or cooldown. Output:
   { "kind": "hype_tag", "product_id": "...", "product_name": "...",
     "scope_type": "team" | "player" | "product" | "variant",
     "scope_team": ..., "scope_player_id": ..., "variant_name": ...,
     "tag": "release_premium" | "cooled" | "overhyped" | "underhyped",
     "strength": 0.7, "decay_days": 14,
     "source_note": "...", "confidence": 0.8 }
   Prefer scope_type='variant' when the narrative names a specific card or parallel ("Ohtani's orange ref is wild", "the Wemby auto"). Use 'player' only when it's about the player generally in this product. Use 'product' for the whole release. Use 'team' for team-wide moves.

4. RISK_FLAG — injury, suspension, trade, retirement, legal, off_field. Output:
   { "kind": "risk_flag", "player_id": "...", "player_name": "...",
     "flag_type": "injury", "note": "...", "confidence": 0.9 }
   RISK FLAGS ARE LEADING INDICATORS. Emit on the EVENT itself — a news article showing arrest / injury / trade / suspension / retirement is enough. DO NOT gatekeep on "is the market reacting yet?" or "is this generating breaker discussion?" The whole point of risk_flag is to capture the event BEFORE the market reacts so our score modulation can pre-adjust prices. Player name + flag_type + a factual note from the source is sufficient. Confidence reflects how clearly the event is established (high for news articles / official statements / verified reports; lower for unsourced rumors).
   ROSTER SCOPE: RISK_FLAG can match against BOTH tiers — default-tier active-product players AND \`*risk-only\` players. This is the explicit exception to the rule that other update kinds only match the default tier.
   Other update kinds (sentiment, hype_tag, asking_price, odds_observation, team/product sentiment) still need market context AND a default-tier match — but RISK_FLAG is the explicit exception on both.

5. ODDS_OBSERVATION — a specific card pulls at a different rate than the published odds. Output:
   { "kind": "odds_observation", "product_id": "...", "product_name": "...",
     "scope_type": "variant" | "player",
     "scope_player_id": "...",                    // always set
     "variant_name": "Black Prism /1",            // when scope_type='variant'
     "composition": { "hobby": null },            // same shape as asking_price — formats involved
     "observed_odds_per_case": 80,                // "1 in 80 cases" → 80
     "source": "ebay_listing" | "stream_ask" | "social_post" | "other",
     "source_note": "...", "confidence": 0.7 }
   Use this only when someone explicitly reports a per-case pull rate that contradicts the odds sheet (e.g. "this card is hitting 1 in 80 cases on hobby, way rarer than published"). DO NOT emit this for "X is a chase" or "X is rare" without a number. composition follows the same rules as asking_price.

6. TEAM_SENTIMENT — a take on a whole team across every product they're in. Use for "Royals are stacked this year", "Tigers' farm is loaded", "Cowboys are a sell". Output:
   { "kind": "team_sentiment", "team_name": "Kansas City Royals",
     "direction": 1 | -1, "strength": 0.8, "decay_days": 30,
     "tag": "stacked_roster",                     // optional, free text
     "source_note": "...", "confidence": 0.85 }
   team_name must match a team string used by players in the roster above. direction=+1 for bullish, -1 for bearish. Skip neutral takes — emit nothing for "Royals are OK" or "Royals are average". Caps at a small per-scope contribution, so don't overstate strength — 0.8 is reserved for "stacked roster, top of the league".

7. PRODUCT_SENTIMENT — a take on a whole product. "2026 Bowman is the loaded class", "Bowman Draft is going to print money", "Topps Chrome was a flop". Output:
   { "kind": "product_sentiment", "product_id": "...", "product_name": "...",
     "direction": 1 | -1, "strength": 0.7, "decay_days": 60,
     "tag": "loaded_class",                       // optional
     "source_note": "...", "confidence": 0.8 }
   Use product_sentiment ONLY for the overall product take. If the narrative is really about a team or a specific player IN this product, use a more specific scope (team_product_sentiment, hype_tag scope=team/player, or sentiment).

8. TEAM_PRODUCT_SENTIMENT — a take on one team specifically in one product. "Pirates in 2026 Bowman are loaded", "Mavs in Prizm are a sleeper". Output:
   { "kind": "team_product_sentiment",
     "team_name": "Pittsburgh Pirates",
     "product_id": "...", "product_name": "...",
     "direction": 1 | -1, "strength": 0.8, "decay_days": 30,
     "tag": "intersection_pop",                   // optional
     "source_note": "...", "confidence": 0.85 }
   Use when the take is the intersection of a team and a product. If the narrative is about the team across all products, use team_sentiment instead. If it's about the product as a whole, use product_sentiment.

CASCADE DIFFERENTIATION (kinds 6–8 vs 3 hype_tag):
- hype_tag is for the four canonical labels (release_premium / cooled / overhyped / underhyped) — use it when the narrative names one of those four patterns explicitly.
- team_sentiment / product_sentiment / team_product_sentiment are general bullish/bearish takes WITHOUT one of those four canonical labels. Don't emit both for the same observation — pick the more specific match.

Return JSON ONLY — a JSON array of update objects. No markdown, no explanation, no text before or after. If nothing extractable, return exactly: []

CRITICAL:
- Use exact ids from the roster lines above — never invent or guess ids.
- For player_name / product_name fields, copy the exact name from the matching roster line so we can verify your match.
- **Nickname matching is mandatory, not optional.** Famous nicknames ALWAYS resolve to the canonical player. Examples (non-exhaustive):
    Wemby / Wembyana / Webanyama → Victor Wembanyama
    Luka / Donc / Doncic → Luka Dončić
    CJ Stroud / C.J. Stroud → C.J. Stroud
    Tua → Tua Tagovailoa
    Shedeur → Shedeur Sanders
    Cooper Flagg / Flagg → Cooper Flagg
    Concan → Paul Skenes (sometimes), or Roki Sasaki — use context
    Schwarber → Kyle Schwarber
    Ohtani / Shohei → Shohei Ohtani
    Soto → Juan Soto
  If the narrative names a famous player by nickname or short form, and that player IS in the roster, match to them. If a nickname is genuinely ambiguous (multiple players go by it), choose the most contextually likely one (e.g. NBA player for a basketball card narrative, MLB player for a baseball narrative). NEVER substitute a different player just because their name shares a syllable or position — wrong attributions are worse than missing ones.
- One narrative can produce multiple updates of different kinds.
- DO NOT SUBSTITUTE. If a named player or product isn't in the roster AND the name isn't a recognized nickname for someone who IS, OMIT that update entirely. Example: if the narrative mentions "Joe Smith" and no Joe Smith / J. Smith / no obvious nickname for Joe is in the roster, drop the update — do not pick John Smith.
- variant_name is free text — copy it verbatim from the narrative ("Orange Refractor /99", "Black Prism /1"). We don't have a variant roster yet, so don't try to match against one.
- It is fine to return fewer updates than the narrative implies, or even an empty array, if you can't make confident matches. EXCEPTION: see RISK_FLAG rule below — risk flags should be emitted whenever a clear factual event (arrest, injury, trade, suspension, retirement) is shown, regardless of market context.
- RISK_FLAG EMIT-BY-DEFAULT: if the screenshot or narrative shows a clear factual event about a player who IS in the roster, EMIT THE RISK_FLAG. Example: a news article showing "Josh Jacobs was arrested and booked on domestic violence charges" → emit { kind: 'risk_flag', player_id: <Josh Jacobs id>, flag_type: 'legal' or 'off_field', note: '<one-line factual summary>', confidence: 0.9 }. The fact that it's a news article (not a sports card market post) is NOT a reason to skip — risk flags exist precisely to capture events that haven't yet moved the market.`;

  // Build content blocks — N image blocks (in supplied order) + text prompt.
  // Mirrors the parseBreakPrice path so route handlers can stay cookie-cutter.
  // Skip the image path entirely when no images so we keep the cheaper text-
  // only Claude call (and avoid wrapping a single-text message in an array).
  type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  const userContent:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image'; source: { type: 'base64'; media_type: ImageMediaType; data: string } }
      > = hadImage
    ? (() => {
        const blocks: Array<
          | { type: 'text'; text: string }
          | { type: 'image'; source: { type: 'base64'; media_type: ImageMediaType; data: string } }
        > = [];
        for (const img of imageList) {
          blocks.push({
            type: 'image',
            source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
          });
        }
        blocks.push({ type: 'text', text: prompt });
        return blocks;
      })()
    : prompt;

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await client.messages.create(
    {
      model: 'claude-haiku-4-5-20251001',
      // Vision responses run wider (multiple players + sentiments per screenshot
      // are routine); 2048 was the silent failure mode for parseBreakPrice
      // before May 14. Match the 8192 ceiling there for parity. Text-only
      // /insight calls don't pay for the extra ceiling — max_tokens is an
      // upper bound, not a billed amount.
      max_tokens: hadImage ? 8192 : 2048,
      messages: [{ role: 'user', content: userContent }],
    },
    { timeout: hadImage ? 30_000 : 25_000 },
  );

  const raw = (message.content[0] as { type: string; text: string }).text.trim();
  console.log(`[insights-parser] roster=${players.length} products=${products.length} narrative_chars=${narrativeText.length} images=${imageList.length} raw_response_chars=${raw.length}`);
  console.log(`[insights-parser] raw response (first 800): ${raw.slice(0, 800)}`);

  const debugBase = {
    rosterSize: players.length,
    productsCount: products.length,
    rawResponseExcerpt: raw.slice(0, 600),
    hadImage,
    hadNarrative,
  };

  const arrayMatch = raw.match(/\[[\s\S]*\]/);
  if (!arrayMatch) {
    console.warn(`[insights-parser] no JSON array found in response`);
    return { updates: [], debug: { ...debugBase, parsedRawCount: 0, droppedReasons: ['no JSON array in response'] } };
  }

  let parsed: ParsedUpdate[];
  try {
    parsed = JSON.parse(arrayMatch[0]);
  } catch (err) {
    console.warn(`[insights-parser] JSON parse failed: ${err instanceof Error ? err.message : err}`);
    return { updates: [], debug: { ...debugBase, parsedRawCount: 0, droppedReasons: [`json parse: ${err instanceof Error ? err.message : err}`] } };
  }
  console.log(`[insights-parser] parsed ${parsed.length} raw updates before validation`);

  // Validate: drop anything referencing an unknown id and clamp score/strength.
  const validProductIds = new Set(products.map(p => p.id));
  const playerById = new Map(players.map((p: any) => [p.id, { name: p.name, team: p.team }]));
  const productById = new Map(products.map(p => [p.id, p.name]));
  // Cascade sentiment kinds reference a team by string. Build a case-insensitive
  // set of valid teams from the roster so we drop rows whose team_name doesn't
  // match anything in the DB (those rows would write but never affect any
  // player_product at engine-read time).
  const validTeamsLower = new Set(
    players.map((p: any) => (p.team ?? '').trim().toLowerCase()).filter((t: string) => t.length > 0),
  );
  const canonicalTeamByLower = new Map<string, string>();
  for (const p of players as any[]) {
    const t = (p.team ?? '').trim();
    if (!t) continue;
    const lower = t.toLowerCase();
    if (!canonicalTeamByLower.has(lower)) canonicalTeamByLower.set(lower, t);
  }

  // We don't validate the model's claimed name against the DB name anymore
  // — the original Wemby->Robinson bug was caused by a truncated roster
  // (now fixed), not by hallucinated ids. A name-match check that's loose
  // enough to accept nicknames ("Wemby" matches "Victor Wembanyama") is
  // also loose enough to miss real hallucinations, and a tight check
  // false-rejects nicknames. Trust the player_id; the model's roster is
  // now complete so it has no reason to substitute.
  const out: ParsedUpdate[] = [];
  const dropReasons: string[] = [];
  for (const u of parsed) {
    if (!u || typeof u !== 'object' || !('kind' in u)) {
      dropReasons.push(`shape: ${JSON.stringify(u)?.slice(0, 100)}`);
      continue;
    }

    switch (u.kind) {
      case 'sentiment': {
        if (!playerById.has(u.player_id)) {
          dropReasons.push(`sentiment: unknown player_id=${u.player_id}`);
          continue;
        }
        // Default to global if scope is missing/invalid — preserves today's
        // fan-out behavior. 'product' requires a valid product_id.
        const rawScope = (u as { scope?: string }).scope;
        const scope: 'global' | 'product' = rawScope === 'product' ? 'product' : 'global';
        if (scope === 'product' && !validProductIds.has(u.product_id ?? '')) {
          dropReasons.push(`sentiment: scope=product but unknown product_id=${u.product_id}`);
          continue;
        }
        const known = playerById.get(u.player_id)!;
        out.push({
          kind: 'sentiment',
          player_id: u.player_id,
          player_name: known.name,
          scope,
          product_id: scope === 'product' ? u.product_id : undefined,
          score: Math.max(-0.5, Math.min(0.5, Number(u.score) || 0)),
          note: String(u.note ?? '').slice(0, 240),
          confidence: Math.max(0, Math.min(1, Number(u.confidence) || 0)),
        });
        break;
      }
      case 'risk_flag': {
        if (!playerById.has(u.player_id)) {
          dropReasons.push(`risk_flag: unknown player_id=${u.player_id}`);
          continue;
        }
        const known = playerById.get(u.player_id)!;
        const validFlags = ['injury', 'suspension', 'legal', 'trade', 'retirement', 'off_field'] as const;
        if (!validFlags.includes(u.flag_type as typeof validFlags[number])) continue;
        out.push({
          kind: 'risk_flag',
          player_id: u.player_id,
          player_name: known.name,
          flag_type: u.flag_type,
          note: String(u.note ?? '').slice(0, 500),
          confidence: Math.max(0, Math.min(1, Number(u.confidence) || 0)),
        });
        break;
      }
      case 'asking_price': {
        if (!validProductIds.has(u.product_id)) {
          dropReasons.push(`asking_price: unknown product_id=${u.product_id}`);
          continue;
        }
        if ((u.scope_type === 'player' || u.scope_type === 'variant') && !playerById.has(u.scope_player_id ?? '')) {
          dropReasons.push(`asking_price: unknown scope_player_id=${u.scope_player_id}`);
          continue;
        }
        if (!['team', 'player', 'product', 'variant'].includes(u.scope_type)) {
          dropReasons.push(`asking_price: invalid scope_type=${u.scope_type}`);
          continue;
        }
        const compResult = validateComposition((u as { composition: unknown }).composition);
        if (!compResult.ok) {
          dropReasons.push(`asking_price: ${compResult.reason}`);
          continue;
        }
        const validSources: AskingPriceSource[] = ['ebay_listing', 'stream_ask', 'social_post', 'other'];
        const source: AskingPriceSource = validSources.includes(u.source) ? u.source : 'other';
        out.push({
          kind: 'asking_price',
          product_id: u.product_id,
          product_name: productById.get(u.product_id) ?? u.product_name,
          scope_type: u.scope_type,
          scope_team: u.scope_team,
          scope_player_id: u.scope_player_id,
          variant_name: u.scope_type === 'variant' ? String(u.variant_name ?? '').slice(0, 120) : undefined,
          composition: compResult.comp,
          price_low: Math.max(0, Number(u.price_low) || 0),
          price_high: Math.max(0, Number(u.price_high) || 0),
          source,
          source_note: String(u.source_note ?? '').slice(0, 240),
          confidence: Math.max(0, Math.min(1, Number(u.confidence) || 0)),
        });
        break;
      }
      case 'hype_tag': {
        if (!validProductIds.has(u.product_id)) {
          dropReasons.push(`hype_tag: unknown product_id=${u.product_id}`);
          continue;
        }
        if ((u.scope_type === 'player' || u.scope_type === 'variant') && !playerById.has(u.scope_player_id ?? '')) {
          dropReasons.push(`hype_tag: unknown scope_player_id=${u.scope_player_id}`);
          continue;
        }
        if (!['team', 'player', 'product', 'variant'].includes(u.scope_type)) {
          dropReasons.push(`hype_tag: invalid scope_type=${u.scope_type}`);
          continue;
        }
        const validTags = ['release_premium', 'cooled', 'overhyped', 'underhyped'] as const;
        if (!validTags.includes(u.tag as typeof validTags[number])) {
          dropReasons.push(`hype_tag: invalid tag=${u.tag}`);
          continue;
        }
        out.push({
          kind: 'hype_tag',
          product_id: u.product_id,
          product_name: productById.get(u.product_id) ?? u.product_name,
          scope_type: u.scope_type,
          scope_team: u.scope_team,
          scope_player_id: u.scope_player_id,
          variant_name: u.scope_type === 'variant' ? String(u.variant_name ?? '').slice(0, 120) : undefined,
          tag: u.tag,
          strength: Math.max(0, Math.min(1, Number(u.strength) || 0)),
          decay_days: Math.max(1, Math.min(60, Number(u.decay_days) || 14)),
          source_note: String(u.source_note ?? '').slice(0, 240),
          confidence: Math.max(0, Math.min(1, Number(u.confidence) || 0)),
        });
        break;
      }
      case 'odds_observation': {
        if (!validProductIds.has(u.product_id)) {
          dropReasons.push(`odds_observation: unknown product_id=${u.product_id}`);
          continue;
        }
        if (!playerById.has(u.scope_player_id ?? '')) {
          dropReasons.push(`odds_observation: unknown scope_player_id=${u.scope_player_id}`);
          continue;
        }
        if (!['variant', 'player'].includes(u.scope_type)) {
          dropReasons.push(`odds_observation: invalid scope_type=${u.scope_type}`);
          continue;
        }
        const compResult = validateComposition((u as { composition: unknown }).composition);
        if (!compResult.ok) {
          dropReasons.push(`odds_observation: ${compResult.reason}`);
          continue;
        }
        const obs = Number(u.observed_odds_per_case);
        if (!Number.isFinite(obs) || obs <= 0) {
          dropReasons.push(`odds_observation: invalid observed_odds_per_case=${u.observed_odds_per_case}`);
          continue;
        }
        const validSources: AskingPriceSource[] = ['ebay_listing', 'stream_ask', 'social_post', 'other'];
        const source: AskingPriceSource = validSources.includes(u.source) ? u.source : 'other';
        out.push({
          kind: 'odds_observation',
          product_id: u.product_id,
          product_name: productById.get(u.product_id) ?? u.product_name,
          scope_type: u.scope_type,
          scope_player_id: u.scope_player_id,
          variant_name: u.scope_type === 'variant' ? String(u.variant_name ?? '').slice(0, 120) : undefined,
          composition: compResult.comp,
          // Cap at 10000 — anything rarer than 1:10000 is almost certainly
          // a misread of "1/1" or per-set numbering. Smallest is 1 (every case).
          observed_odds_per_case: Math.max(1, Math.min(10000, Math.round(obs))),
          source,
          source_note: String(u.source_note ?? '').slice(0, 240),
          confidence: Math.max(0, Math.min(1, Number(u.confidence) || 0)),
        });
        break;
      }
      case 'team_sentiment': {
        const teamRaw = String(u.team_name ?? '').trim();
        const teamLower = teamRaw.toLowerCase();
        if (!teamRaw || !validTeamsLower.has(teamLower)) {
          dropReasons.push(`team_sentiment: unknown team_name=${teamRaw}`);
          continue;
        }
        const direction = u.direction === -1 ? -1 : u.direction === 1 ? 1 : 0;
        if (!direction) {
          dropReasons.push(`team_sentiment: missing direction (must be 1 or -1)`);
          continue;
        }
        out.push({
          kind: 'team_sentiment',
          team_name: canonicalTeamByLower.get(teamLower) ?? teamRaw,
          direction,
          strength: Math.max(0, Math.min(1, Number(u.strength) || 0)),
          decay_days: Math.max(1, Math.min(60, Number(u.decay_days) || 30)),
          tag: u.tag ? String(u.tag).slice(0, 60) : undefined,
          source_note: String(u.source_note ?? '').slice(0, 240),
          confidence: Math.max(0, Math.min(1, Number(u.confidence) || 0)),
        });
        break;
      }
      case 'product_sentiment': {
        if (!validProductIds.has(u.product_id)) {
          dropReasons.push(`product_sentiment: unknown product_id=${u.product_id}`);
          continue;
        }
        const direction = u.direction === -1 ? -1 : u.direction === 1 ? 1 : 0;
        if (!direction) {
          dropReasons.push(`product_sentiment: missing direction (must be 1 or -1)`);
          continue;
        }
        out.push({
          kind: 'product_sentiment',
          product_id: u.product_id,
          product_name: productById.get(u.product_id) ?? u.product_name,
          direction,
          strength: Math.max(0, Math.min(1, Number(u.strength) || 0)),
          decay_days: Math.max(1, Math.min(60, Number(u.decay_days) || 30)),
          tag: u.tag ? String(u.tag).slice(0, 60) : undefined,
          source_note: String(u.source_note ?? '').slice(0, 240),
          confidence: Math.max(0, Math.min(1, Number(u.confidence) || 0)),
        });
        break;
      }
      case 'team_product_sentiment': {
        const teamRaw = String(u.team_name ?? '').trim();
        const teamLower = teamRaw.toLowerCase();
        if (!teamRaw || !validTeamsLower.has(teamLower)) {
          dropReasons.push(`team_product_sentiment: unknown team_name=${teamRaw}`);
          continue;
        }
        if (!validProductIds.has(u.product_id)) {
          dropReasons.push(`team_product_sentiment: unknown product_id=${u.product_id}`);
          continue;
        }
        const direction = u.direction === -1 ? -1 : u.direction === 1 ? 1 : 0;
        if (!direction) {
          dropReasons.push(`team_product_sentiment: missing direction (must be 1 or -1)`);
          continue;
        }
        out.push({
          kind: 'team_product_sentiment',
          team_name: canonicalTeamByLower.get(teamLower) ?? teamRaw,
          product_id: u.product_id,
          product_name: productById.get(u.product_id) ?? u.product_name,
          direction,
          strength: Math.max(0, Math.min(1, Number(u.strength) || 0)),
          decay_days: Math.max(1, Math.min(60, Number(u.decay_days) || 30)),
          tag: u.tag ? String(u.tag).slice(0, 60) : undefined,
          source_note: String(u.source_note ?? '').slice(0, 240),
          confidence: Math.max(0, Math.min(1, Number(u.confidence) || 0)),
        });
        break;
      }
    }
  }

  if (dropReasons.length > 0) {
    console.log(`[insights-parser] dropped ${dropReasons.length} updates: ${dropReasons.slice(0, 8).join(' | ')}`);
  }
  console.log(`[insights-parser] returning ${out.length} validated updates`);

  return {
    updates: out,
    debug: {
      ...debugBase,
      parsedRawCount: parsed.length,
      droppedReasons: dropReasons,
    },
  };
}

/** Pretty one-line summary used in the bot reply. */
export function summarizeUpdate(u: ParsedUpdate): string {
  switch (u.kind) {
    case 'sentiment': {
      const scopeLabel = u.scope === 'product' ? ' (this product only)' : '';
      return `${u.player_name}${scopeLabel}: sentiment ${u.score >= 0 ? '+' : ''}${u.score} — ${u.note}`;
    }
    case 'risk_flag':
      return `${u.player_name}: ${u.flag_type} — ${u.note}`;
    case 'asking_price': {
      const where =
        u.scope_type === 'team' ? `${u.scope_team} slot`
        : u.scope_type === 'variant' ? `${u.variant_name ?? 'variant'}`
        : u.scope_type === 'player' ? `player slot`
        : `${u.product_name} bundle`;
      const range = u.price_low === u.price_high ? `$${u.price_low}` : `$${u.price_low}–$${u.price_high}`;
      return `${where} (${renderComposition(u.composition)}, ${u.source}): asking ${range} — ${u.source_note}`;
    }
    case 'hype_tag': {
      const where =
        u.scope_type === 'team' ? u.scope_team
        : u.scope_type === 'variant' ? (u.variant_name ?? 'variant')
        : u.scope_type === 'player' ? 'player'
        : u.product_name;
      return `${where}: ${u.tag} (strength ${u.strength.toFixed(2)}, decay ${u.decay_days}d)`;
    }
    case 'odds_observation':
      return `${u.variant_name ?? 'card'} (${renderComposition(u.composition)}): observed 1:${u.observed_odds_per_case} cases — ${u.source_note}`;
    case 'team_sentiment': {
      const arrow = u.direction === 1 ? '↑' : '↓';
      const tag = u.tag ? ` [${u.tag}]` : '';
      return `${u.team_name} (all products) ${arrow} strength ${u.strength.toFixed(2)}, decay ${u.decay_days}d${tag} — ${u.source_note}`;
    }
    case 'product_sentiment': {
      const arrow = u.direction === 1 ? '↑' : '↓';
      const tag = u.tag ? ` [${u.tag}]` : '';
      return `${u.product_name} ${arrow} strength ${u.strength.toFixed(2)}, decay ${u.decay_days}d${tag} — ${u.source_note}`;
    }
    case 'team_product_sentiment': {
      const arrow = u.direction === 1 ? '↑' : '↓';
      const tag = u.tag ? ` [${u.tag}]` : '';
      return `${u.team_name} × ${u.product_name} ${arrow} strength ${u.strength.toFixed(2)}, decay ${u.decay_days}d${tag} — ${u.source_note}`;
    }
  }
}

/**
 * Salvage a JSON array of objects from a Claude response that may be:
 *   - wrapped in ```json … ``` markdown fences (Haiku does this often)
 *   - truncated mid-array because max_tokens was hit (no closing `]`)
 *   - truncated mid-object inside an array (last `{ … }` never closed)
 *
 * Strategy: strip code fences, find the opening `[`, walk character-by-character
 * tracking string + brace depth, parse each top-level `{…}` as a standalone
 * object and collect what validates. Stop at the first `]` we encounter at
 * depth 0, OR at end-of-string (truncation case). Last partial object is
 * silently dropped — we'd rather return 17 valid asking_price rows than
 * throw all 18 away because the closing bracket never came.
 *
 * Returns null only when no `[` is found at all.
 */
export function salvageJsonArrayObjects(raw: string): unknown[] | null {
  // Strip a single code-fence wrapper if present. Tolerates both ```json and bare ```.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = fenced ? fenced[1] : raw;

  const start = body.indexOf('[');
  if (start === -1) return null;
  body = body.slice(start + 1);

  const objects: unknown[] = [];
  let depth = 0;
  let inString = false;
  let escape = false;
  let objStart = -1;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart !== -1) {
        try {
          objects.push(JSON.parse(body.slice(objStart, i + 1)));
        } catch {
          // Skip malformed object; keep going — later siblings may parse fine.
        }
        objStart = -1;
      }
    } else if (ch === ']' && depth === 0) {
      break;
    }
  }

  return objects;
}

// ─── /break-price — specialized parser ──────────────────────────────────
//
// Single-purpose: extract asking_price observations from a narrative, an
// image (Whatnot/Fanatics/eBay screenshot), or both. Returns only
// `asking_price` ParsedUpdate rows so the apply path can reuse the
// existing /insight handler for asking_price.
//
// Multi-team and multi-format bundles are EXPLICITLY out of scope — see
// docs/edge-cases.md. The prompt tells Claude to drop them.

export type BreakPriceImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

export interface BreakPriceImage {
  /** Base64-encoded image bytes (no data: prefix). */
  base64: string;
  mediaType: BreakPriceImageMediaType;
}

export interface BreakPriceInput {
  /** At least one of narrative / imageBase64 / images[] must be set. */
  narrative?: string;
  /** Legacy single-image path used by the /break-price slash command. */
  imageBase64?: string;
  imageMediaType?: BreakPriceImageMediaType;
  /**
   * Multi-image path used by the message context-menu command. When set
   * and non-empty, takes precedence over `imageBase64` — Claude receives
   * one image content block per entry, in the order supplied. Same break
   * = one parse pass = one proposal. Cap enforced by the caller.
   */
  images?: BreakPriceImage[];
  /** Optional context to add to the prompt. User-supplied at the
   * original /break-price slash command — treated as "additional
   * context," NOT as authoritative override. For refine-time
   * corrections, use `refineCorrection` below instead. */
  notes?: string;
  /**
   * Authoritative correction supplied by the contributor via the
   * refine flow. Rendered as a dedicated "CONTRIBUTOR CORRECTION
   * (authoritative)" section with override language. Mirrors the
   * same field on parseInsights — disambiguates "more user context
   * at original-parse time" (notes) from "the user is telling you
   * the previous proposal was wrong" (refineCorrection).
   */
  refineCorrection?: string;
  /**
   * Optional explicit product id (picked from Discord autocomplete). When
   * supplied, the parser scopes the candidate-products roster to just this
   * one product and instructs Claude to use it without inferring. Common
   * case for SMEs watching a single stream — they pick the product once,
   * then drop short narratives or screenshots for slot after slot.
   */
  productId?: string;
}

export interface BreakPriceResult {
  updates: Extract<ParsedUpdate, { kind: 'asking_price' }>[];
  debug: {
    rosterSize: number;
    productsCount: number;
    rawResponseExcerpt: string;
    parsedRawCount: number;
    droppedReasons: string[];
    hadImage: boolean;
    hadNarrative: boolean;
  };
}

export async function parseBreakPrice(input: BreakPriceInput): Promise<BreakPriceResult> {
  const hadNarrative = !!input.narrative?.trim();

  // Normalize legacy single-image input + multi-image input into one
  // array. Caller can supply either; `images` wins when both are set.
  const images: BreakPriceImage[] = (() => {
    if (input.images && input.images.length > 0) return input.images;
    if (input.imageBase64) {
      return [{
        base64: input.imageBase64,
        mediaType: (input.imageMediaType ?? 'image/png') as BreakPriceImageMediaType,
      }];
    }
    return [];
  })();
  const hadImage = images.length > 0;
  const imageCount = images.length;

  const baseDebug = {
    rosterSize: 0,
    productsCount: 0,
    rawResponseExcerpt: '',
    parsedRawCount: 0,
    droppedReasons: [] as string[],
    hadImage,
    hadNarrative,
  };

  if (!hadNarrative && !hadImage) {
    return { updates: [], debug: { ...baseDebug, rawResponseExcerpt: 'no input' } };
  }

  // Roster fetch — same shape as parseInsights but only loads active
  // products. We don't need the full player roster for asking_price
  // captures since scope_player_id is rare (most asks are team-scoped).
  // But we still load it so player-scoped asks work.
  //
  // When the caller pinned a specific product via Discord autocomplete
  // (input.productId), we scope the candidate list to just that product
  // and tell Claude to use it directly. Removes the most common reason
  // for empty parses ("which Topps Chrome did you mean?").
  let productQuery = supabaseAdmin
    .from('products')
    .select('id, name, year, lifecycle_status, product_line, hobby_case_cost, bd_case_cost, jumbo_case_cost')
    .eq('is_active', true)
    .in('lifecycle_status', ['live', 'pre_release']);
  if (input.productId) {
    productQuery = productQuery.eq('id', input.productId);
  }
  const { data: products, error: prodErr } = await productQuery;

  if (prodErr || !products?.length) {
    return {
      updates: [],
      debug: {
        ...baseDebug,
        productsCount: 0,
        rawResponseExcerpt: prodErr?.message ?? (input.productId ? `productId ${input.productId} not found or inactive` : 'no active products'),
        droppedReasons: [input.productId ? 'pinned product not in active set' : 'no active products'],
      },
    };
  }

  let players: Array<{ id: string; name: string; team: string }> = [];
  {
    // Scope to players in active products (any insert_only flag) —
    // same fix as parseInsights. The full players table now has 6,666
    // solo entries and alphabetical sort + 5000 cap was silently
    // dropping Victor Wembanyama (V/W) below the cut. See parseInsights
    // for the full incident write-up. Inner-join filter + in-process
    // dedupe.
    const seen = new Set<string>();
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data } = await supabaseAdmin
        .from('players')
        .select('id, name, team, player_products!inner(products!inner(is_active))')
        .eq('player_products.products.is_active', true)
        .not('name', 'like', '%/%')
        .order('name')
        .range(from, from + PAGE - 1);
      if (!data || data.length === 0) break;
      for (const row of data as Array<{ id: string; name: string; team: string }>) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        players.push(row);
      }
      if (data.length < PAGE || players.length >= 5000) break;
    }
    // Defense in depth: drop card-subset codes (matches parseInsights).
    players = players.filter(p => !isCardSubsetCode(p.name));
  }

  // Each product line ships its known available formats (derived from
  // *_case_cost nullability) and brand-line taxonomy (specialty products
  // like Bowman Best are hobby-only by convention). Lets Claude reason
  // about "JUMBO" titled breaks on hobby-only products without flipping
  // composition to jumbo when no jumbo SKU exists.
  const productLines = products.map((p: {
    id: string;
    name: string;
    year: string;
    product_line: string | null;
    hobby_case_cost: number | null;
    bd_case_cost: number | null;
    jumbo_case_cost: number | null;
  }) => {
    const formats: string[] = [];
    if (p.hobby_case_cost != null) formats.push('hobby');
    if (p.bd_case_cost != null)    formats.push('bd');
    if (p.jumbo_case_cost != null) formats.push('jumbo');
    const lineTag = p.product_line ? ` line=${p.product_line}` : '';
    const formatsTag = formats.length > 0 ? ` formats=${formats.join(',')}` : '';
    return `- ${p.year} ${p.name} [id: ${p.id}${lineTag}${formatsTag}]`;
  }).join('\n');

  const productPinned = !!input.productId;
  const prompt = `You are extracting a live-break slot ask price from a sports card market observation.

${productPinned
    ? `The contributor PINNED the product for this capture — you do not need to infer it. Use this product id exactly:\n${productLines}`
    : `Available products (use product ids exactly):\n${productLines}`}

${
    hadNarrative
      ? `Narrative from the contributor:\n"""\n${input.narrative!.trim()}\n"""`
      : 'No narrative provided — extract from the image only.'
  }
${input.notes?.trim() ? `\nAdditional context:\n"""\n${input.notes.trim()}\n"""` : ''}
${input.refineCorrection?.trim() ? `
CONTRIBUTOR CORRECTION (authoritative — overrides ANY conflicting interpretation of the narrative / image above):
"""
${input.refineCorrection.trim()}
"""

The contributor saw your prior attempt and is telling you what to fix. When the correction names a specific product, team, player, price, format, or composition, USE THAT — do not second-guess it. If the correction names a player by nickname or with a typo (e.g. "Webanyama" → "Victor Wembanyama"), match to the canonical roster entry. If you previously picked Player/Team/Product A and the correction says "this is Player/Team/Product B," the answer is B and only B.
` : ''}${hadImage
    ? imageCount === 1
      ? '\nA screenshot is attached. Read it carefully — Whatnot, Fanatics Live, eBay listings, and Discord stream embeds all encode the product / team / price / format / platform in their UI.'
      : `\n${imageCount} screenshots are attached, in order. Treat them as ONE capture session from the same break — extract every distinct slot ask across all images, and DEDUPE identical rows that appear in multiple shots (same team + same price + same format = one row, not two). Read each carefully — Whatnot, Fanatics Live, eBay listings, and Discord stream embeds all encode the product / team / price / format / platform in their UI.`
    : ''}

Return JSON ONLY — a JSON array of zero or more asking_price update objects. No markdown, no explanation. Empty array = couldn't extract.

Schema for each asking_price update:
{
  "kind": "asking_price",
  "product_id": "<exact id from the list above>",
  "product_name": "<exact name from the list>",
  "scope_type": "team" | "player" | "product" | "variant",
  "scope_team": "<full team name, only when scope_type=team>",
  "scope_player_id": "<player id, only when scope_type=player or variant>",
  "variant_name": "<free text, only when scope_type=variant>",
  "composition": { "hobby": null },   // SLOT COMPOSITION — see rules below
  "price_low": <integer dollars>,
  "price_high": <integer dollars — same as price_low for a single price, different for a range>,
  "source": "stream_ask" | "ebay_listing" | "social_post" | "other",
  "source_note": "<one-line description of where this came from, e.g. 'Whatnot Dave Adams Sunday break'>",
  "confidence": <0..1>
}

RULES:
- One asking_price ROW PER DISCRETE SLOT ASK. A screenshot with 18 team rows ("Diamondbacks $625, Red Sox $6000, Cubs $625, …") = 18 separate asking_price updates, one per row. A breaker stream listing four slot prices = four updates.
- DISTINGUISH a price-sheet (N rows, each is its own slot) from a multi-team BUNDLE (one combined ask spanning multiple teams). A bundle like "Yankees + Red Sox + Dodgers for $2,400" → return empty array (single combined ask not yet supported, see edge-cases doc). A list like "Yankees $800 / Red Sox $750 / Dodgers $850" → three rows.
- AVAILABLE FORMATS PRECEDES TITLE OVERRIDE (highest priority): each product in the list above ships with a "formats=…" tag listing which formats it actually has SKUs for (hobby/bd/jumbo). A composition key MUST be one of the product's available formats. If the title says "JUMBO" but the product's formats tag is just "hobby" (specialty product like Bowman Best, Topps Chrome, Topps Cosmic Chrome, Topps Finest, Pristine, Donruss Optic), the title is describing the BREAK NAME (a half-case sized hobby break), not the product format — emit { "hobby": null } for those rows. Same logic for BD/DELIGHT titles on jumbo-only or hobby-only products. The product's "line=" tag is a soft hint: lines containing "_best", "_chrome", "_cosmic", "_finest", "_pristine", "_optic", "_sapphire", "_platinum" are typically specialty/hobby-only.
- COMPOSITION RULES — sparse map of formats involved per slot:
  · TITLE-LEVEL FORMAT OVERRIDE (second priority, after available-formats check): scan the break title, section header, or any text repeated above/around every row in a screenshot. If it contains "JUMBO" (case-insensitive — matches "JUMBO", "Jumbo Box", "HALF CASE JUMBO #2", etc.) AND the product's formats tag includes jumbo, classify EVERY emitted row as { "jumbo": null }. Same applies to "BREAKER'S DELIGHT", "DELIGHT", or " BD " as a standalone word → { "bd": null } when the product has bd. The title rule overrides the hobby-only-platform default below but is itself overridden by available-formats above. Examples:
      "HALF CASE JUMBO #2 Random Team auction" + product formats=hobby,bd,jumbo  → all rows { "jumbo": null }
      "HALF CASE JUMBO #2 Random Team auction" + product formats=hobby           → all rows { "hobby": null } (title describes break name, not format)
      "Delight RTB Mixer #4" + product formats=hobby,bd                          → all rows { "bd": null }
      "Bowman Hobby Random Team"                                                 → all rows { "hobby": null }
    When the title says JUMBO and a per-row label ALSO says JUMBO, that's the same fact stated twice — emit one row, not two.
  · Per-row examples (apply only when no title override is present):
      "$45 Diamondbacks" on a hobby-only stream     → { "hobby": null }
      "Bowman hobby per-team"                       → { "hobby": null }
      "Delight slot $300"                           → { "bd": null }
      "Jumbo per-team $800"                         → { "jumbo": null }
      "Delight/hobby, 20 delight 5 hobby per slot"  → { "bd": 20, "hobby": 5 }
      "Delight + hobby" (no per-slot ratio)         → { "bd": null, "hobby": null }
  Single-key + null value = pure-format slot, ratio unspecified. Multi-key = bundled mix. Use "bd" for "delight" / "BD" / "breaker's delight". Never emit "mixed" as a key — express mixing via multiple keys.
- Multi-player bundles inside a one-team slot are FINE — that's still a team slot ask, just with chase cards listed.
- NARRATIVE + SCREENSHOT INTERACTION: when both are present, treat the narrative as PRODUCT/SOURCE/COMPOSITION CONTEXT first ("this is for 2026 Bowman, delight/hobby mix 20 delight + 5 hobby per slot, from Dan Reed's IG DM") and per-row OVERRIDES second ("the actual White Sox price was $6500" → use $6500 for the White Sox row, keep the rest as the screenshot shows). The narrative does NOT cap the number of rows you emit. If the screenshot has 18 rows, emit 18 rows even when the narrative only mentions one. If the narrative specifies a composition that applies to all rows, apply it to every emitted row.
- DO NOT GUESS the product. If you can't match the listing to a product in the list, return empty array. Wrong product attribution is worse than missing data.
- For source: 'stream_ask' = Whatnot/Fanatics Live/breaker stream. 'ebay_listing' = unsold eBay listing. 'social_post' = Twitter/IG/Discord/DM post. 'other' = anything else.
- Composition defaults to { "hobby": null } ONLY when no title-level format override was found AND no per-row format label was stated AND the platform is a hobby-only stream. The title rule above takes precedence over this fallback.
- Team names: use the canonical full name ("Los Angeles Dodgers" not "Dodgers"). If you only see the city/nickname, expand it.
- Player names (chase-card sub-rows): famous nicknames map to canonical roster entries — Wemby → Victor Wembanyama, Luka → Luka Dončić, CJ Stroud → C.J. Stroud, Tua → Tua Tagovailoa, Flagg → Cooper Flagg, Schwarber → Kyle Schwarber, Ohtani → Shohei Ohtani, Soto → Juan Soto. NEVER substitute a different player just because their name shares a syllable. If the name in the narrative / screenshot isn't in the roster and isn't a recognized nickname for someone who is, drop the chase row.
- price_low and price_high are integer dollars. Strip $ and commas. Use literal values — "$700.00" = 700, not 700000. The "." is a decimal point. Do not scale up because a price seems low.
- confidence: 0.9+ if every field is unambiguous in the source. Lower for inferred fields.`;

  // Build the content block — N image blocks (in supplied order) + text.
  type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  const userContent: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: ImageMediaType; data: string } }
  > = [];
  for (const img of images) {
    userContent.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
    });
  }
  userContent.push({ type: 'text', text: prompt });

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await client.messages.create(
    {
      model: 'claude-haiku-4-5-20251001',
      // 8192 fits ~30 asking_price rows (~250 tokens each) — covers Dan-Reed-style
      // 18-team price-sheet screenshots without truncating the closing `]`.
      // Previous 1024 was the silent failure: response cut off mid-object,
      // regex found no array, all rows discarded.
      max_tokens: 8192,
      messages: [{ role: 'user', content: userContent }],
    },
    { timeout: 30_000 },
  );

  const raw = (message.content[0] as { type: string; text: string }).text.trim();
  const debug = {
    ...baseDebug,
    rosterSize: players.length,
    productsCount: products.length,
    rawResponseExcerpt: raw.slice(0, 600),
  };
  console.log(`[break-price] products=${products.length} hadImage=${hadImage} hadNarrative=${hadNarrative} response_chars=${raw.length}`);

  // Salvage handles three failure modes that hit 1024-token responses regularly
  // and still hit 8192-token responses occasionally: markdown code fences,
  // truncated array (no closing `]`), truncated last object. Returns whatever
  // top-level objects parsed cleanly — partial last entry is silently dropped.
  const parsed = salvageJsonArrayObjects(raw);
  if (parsed === null) {
    return { updates: [], debug: { ...debug, droppedReasons: ['no JSON array in response'] } };
  }
  if (parsed.length === 0) {
    return { updates: [], debug: { ...debug, droppedReasons: ['JSON array was empty or had zero parseable objects'] } };
  }
  // Detect truncation so the bot reply can mention it. Heuristic: response
  // ends without the array closer AND we got at least one object.
  const truncatedReason = !raw.trimEnd().endsWith(']') && !raw.trimEnd().endsWith('```')
    ? `response appeared truncated — kept ${parsed.length} parseable object(s); raise max_tokens if this recurs`
    : null;

  const validProductIds = new Set(products.map(p => p.id));
  const productById = new Map(products.map(p => [p.id, p.name]));
  const playerById = new Map(players.map(p => [p.id, p.name]));
  const validSources = new Set(['stream_ask', 'ebay_listing', 'social_post', 'other']);
  const validScopes = new Set(['team', 'player', 'product', 'variant']);

  const valid: Extract<ParsedUpdate, { kind: 'asking_price' }>[] = [];
  const dropped: string[] = [];

  for (const u of parsed) {
    if (!u || typeof u !== 'object' || (u as any).kind !== 'asking_price') {
      dropped.push('not an asking_price update'); continue;
    }
    const row = u as Record<string, unknown>;
    if (!validProductIds.has(row.product_id as string)) {
      dropped.push(`unknown product_id=${row.product_id}`); continue;
    }
    if (!validScopes.has(row.scope_type as string)) {
      dropped.push(`bad scope_type=${row.scope_type}`); continue;
    }
    const compResult = validateComposition(row.composition);
    if (!compResult.ok) {
      dropped.push(compResult.reason); continue;
    }
    if (!validSources.has(row.source as string)) {
      dropped.push(`bad source=${row.source}`); continue;
    }
    const lo = Number(row.price_low);
    const hi = Number(row.price_high);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0 || hi < lo) {
      dropped.push(`bad price range lo=${row.price_low} hi=${row.price_high}`); continue;
    }
    if (row.scope_type === 'player' || row.scope_type === 'variant') {
      if (!playerById.has(row.scope_player_id as string)) {
        dropped.push(`scope_player_id not in roster: ${row.scope_player_id}`); continue;
      }
    }
    if (row.scope_type === 'team' && !(row.scope_team as string)?.trim()) {
      dropped.push('team scope missing scope_team'); continue;
    }

    valid.push({
      kind: 'asking_price',
      product_id: row.product_id as string,
      product_name: productById.get(row.product_id as string) ?? (row.product_name as string),
      scope_type: row.scope_type as 'team' | 'player' | 'product' | 'variant',
      scope_team: row.scope_team as string | undefined,
      scope_player_id: row.scope_player_id as string | undefined,
      variant_name: row.variant_name as string | undefined,
      composition: compResult.comp,
      price_low: Math.round(lo),
      price_high: Math.round(hi),
      source: row.source as AskingPriceSource,
      source_note: (row.source_note as string) ?? '',
      confidence: Math.max(0, Math.min(1, Number(row.confidence) || 0)),
    });
  }

  return {
    updates: valid,
    debug: {
      ...debug,
      parsedRawCount: parsed.length,
      droppedReasons: truncatedReason ? [truncatedReason, ...dropped] : dropped,
    },
  };
}
