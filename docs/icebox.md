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
