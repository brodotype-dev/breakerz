# Icebox — Problems we need to solve later

Long-running tracking doc for ideas that aren't urgent enough to plan now but are too important to lose. Promote to `docs/plans/` when one becomes the next priority.

---

## Upgrade Supabase to Pro at public-beta launch

We're on the Free plan (500 MB DB, 2 GB bandwidth/mo, 50k MAU). Several features we currently can't use because they're Pro-only:

- **HaveIBeenPwned leaked-password protection** — auto-rejects signups using passwords known to be in breach databases. Surfaced as the `auth_leaked_password_protection` advisor lint that we can't fix on Free (2026-05-27). Mitigation in private beta: every signup is admin-vetted via the waitlist flow, so practical risk is low.
- **Custom SMTP** — auth emails (invite, magic link, password reset) currently go through Supabase's shared sender. Pro lets us send via Resend / our own domain. Today this just looks unbranded; not a hard blocker.
- **Daily DB backups + 7-day point-in-time recovery** — on Free we'd need to run our own backup process if we wanted recovery for anything older than rough-edge support. Risk grows with user data accumulation.

**Trigger to upgrade:** flip to Pro ($25/mo, same order as Vercel Pro we already use) when ANY of these hit:
- Public beta opens / waitlist disabled → leaked-password protection becomes meaningful at scale
- DB usage approaches 400 MB (80% of Free cap) — buys headroom before we hit the cliff
- We move auth emails to a custom domain for branding
- A pricing-cache regression makes us wish we had point-in-time recovery

**Until then:** stay on Free, accept the `auth_leaked_password_protection` advisor lint as known-and-tolerated, keep manual signup gating via the waitlist.

---

## Per-sale time-weighted pricing (deferred Plan C / Path 2)

CH's `batch-price-estimate` only returns 90-day aggregates per card. The multiplier approach in [docs/plans/2026-05-11-release-freshness-decay.md](plans/2026-05-11-release-freshness-decay.md) is a coarse first pass. A more rigorous model would:

- Pull per-sale data (date + price) from CH, eBay, or Fanatics — we'd need at least one of these as a per-sale time-series source.
- Apply exponential time decay at the sale level (recent sales weighted more heavily than month-old sales).
- Detect first-2-week price decay automatically rather than via a hardcoded halflife.

**Trigger:** only worth doing if the Plan C multipliers turn out to be too coarse — e.g. PostHog 👎 feedback with category "pricing too low" stays high after Plan C ships, or Kyle reports the numbers still don't match his market sense.

---

## Per-product chase rule library

Cosmic planetary chases (Sun → Pluto), Stadium Club Beam Team, Topps Now hits, Bowman's Best Refractor ladder, etc. Plan A's `anchorConcepts` field on each `ManufacturerDescriptor` is where this would live, but populating it for every product family is a slog.

**Cadence:** add one manufacturer descriptor's full anchorConcepts per quarter, prioritized by upcoming product releases.

---

## Asking-price observation → fair value weighting (Phase 3c)

From the Discord `/insight` capture work: we already store `asking_price` observations with `source` enum (`ebay_listing | stream_ask | social_post`). These are leading indicators CH can't see. Today they're display-only.

Folding them into `marketFairValue` calibration would close the loop:

- If multiple `ebay_listing` asking prices in the last 7 days average 1.3× our pure EV for a given product → bump the lifecycle-aware markup for THIS product to 1.30 (overriding the constant).
- Per-product markup overrides on `products.market_markup_override numeric` (nullable; nullable means "use lifecycle default").

Belongs in a follow-on Phase 3c plan after Plans A/B/C ship.

---

## Build-vs-buy CardHedger revisited

Long term, if CH coverage gaps keep biting us (Bowman Draft Sapphire missing, Topps Series 1/2 contamination, Panini parser brittleness), it may be cheaper to fund 2–3 engineer-months of eBay/Fanatics ingestion + nomenclature normalization than to keep absorbing CH's blind spots.

**Trigger:** revisit when we have 50+ active products and CH coverage is the rate-limiter, or if CH pricing accuracy 👎 feedback share doesn't drop below 10% after Plans A/B/C/3c.

eBay developer API caps at 5,000 calls/day per Brody's spike during the 2026-05-11 call — that ceiling will likely shape the actual architecture (queue-based per-card refresh rather than synchronous).

## Pre-release baseline: sale-amount trend adjustment (v2)

The [pre-release pricing model](plans/2026-08-14-pre-release-pricing.md) v1 baselines a non-rookie off the previous cycle's flat value (previous-product EV, else `raw_avg_90d`). v2: nudge that baseline by the player's **recent sale-amount trend** (rising/falling) so a hot player leans up going into the new product. Source: CardHedger `top-movers` / price-history / `gain`. Deferred from v1 (Brody, 2026-08-14) to keep the first baseline simple and legible.

**Trigger:** once the flat-baseline pre-release board is live and we've eyeballed a couple of pre-releases — add trend if the flat number lags obvious risers/fallers.

---

## Pricing freshness vs CardHedger spend — the 36h TTL alternation

`CH_PRICE_CACHE_TTL_HOURS` is 36h against a 24h pricing cron ([gotcha #15](../CLAUDE.md)). That ended the collapses, but it does **not** make the cache hit every night, which is what PR #259 predicted. A cache *hit* doesn't refresh the row's `fetched_at`, so a card fetched Monday is 24h old Tuesday (hit, row untouched) and 48h old Wednesday — past 36h, so it refetches. The result is a strict **miss / hit / miss / hit** alternation. Measured on 2025 Topps Chrome Football, same 105,890 cards:

| Night | From cache | Fetched live | Duration |
|---|---|---|---|
| Nov 19 | 102,525 | 3,761 | 54s |
| Nov 20 | 400 | 105,890 | 152s |
| Nov 21 | 105,890 | 400 | 49s |
| Nov 22 | 400 | 105,890 | 136s |

**Two consequences, both currently acceptable:**

1. **Prices freeze on hit nights.** A hit night rewrites `pricing_cache` with the previous day's numbers — 99.7% of players had byte-identical `ev_mid` on Nov 21, and 96.5% on Nov 19 (a fetch night runs ~70% unchanged, which is normal market behavior). So the big products effectively reprice **every other day**, and a served price can be ~2 days old. Also means trend arrows will stair-step: flat day, move day.
2. **The collapse protection is now headroom, not caching.** Full-fetch nights finish in 136–152s against the 295s `HARD_DEADLINE_MS`. That ~145s of margin is what prevents a repeat — the same full-fetch workload took 287s on Oct 29. The coverage guard (#258) sits behind it as the seatbelt.

**Decision (Brody, 2026-11-22):** leave it. With 5 profiles and no traffic, half the CH spend is worth more than same-day prices.

**Trigger to revisit — any of these:**
- **Real users arrive** (public beta, or the 22 approved invitees convert) — "yesterday's price" is defensible, "the day before yesterday's" is harder to defend on a page whose whole claim is catching mispricing in real time.
- **Any worker run exceeds ~240s** — the margin is eroding; check `cron_run_log.details->'summary'` for `totalDurationMs` and `partial`.
- **`coverageGuardSkipped` goes non-zero** — the seatbelt caught something; the margin is gone.
- **Active product count grows materially** (the streaming-refresh plan already fires at 25) — more cards per night, less headroom.
- **A V-shape reappears** in `player_product_ev_snapshots` (drop >50% then recover next day).

**The fix when triggered:** set the TTL *below* the cron interval (e.g. 20h) so every night is a full fetch — fresh prices daily, no freeze, ~150s per night, roughly double the CardHedger calls. Do **not** solve it by refreshing `fetched_at` on a cache hit: that makes the cache always-fresh and prices would stop updating entirely. And per gotcha #15, never set it back to exactly 24h.
