# PRD: Card Lookup Tool

**Status:** Live
**Route:** `/admin/card-lookup`
**Audience:** Internal (Brody) — personal auction bidding aid
**First shipped:** 2026-03-27

---

## Problem

When browsing card auctions (eBay, Goldin, PWCC, etc.), it's hard to know in real-time what a specific graded card is worth before placing a bid. Manually searching CardHedger, checking PSA pop reports, and estimating a ceiling takes time and is error-prone when you're watching a live auction.

---

## Goal

Given a screenshot of an auction listing, instantly surface:
- Card identity confirmation
- Grade-level price estimates across all PSA/BGS/SGC grades
- Recent comparable sales (comps)
- A calculated max bid ceiling based on a user-defined margin

---

## Non-goals

- Consumer-facing: this is admin-only, not surfaced to end users
- Portfolio tracking, watchlists, alerts — out of scope for now
- BGS/CGC-specific pop report data

---

## User Flow

1. Navigate to `/admin/card-lookup`
2. Drop or upload a screenshot of an auction listing (JPEG, PNG, WebP)
3. Click **Parse with AI** — Claude Haiku (vision) extracts card details from the screenshot
4. Review and correct extracted fields if needed (player, set, year, card number, variant, grading company, grade, cert number)
5. Click **Look Up by Cert** (or **Search by Name** if no cert was found)
6. Results panel populates with: card identity, grade prices table, recent comps, max bid calculator
7. Adjust margin % → max bid updates live

---

## Data Sources

### Claude Haiku (vision) — parse step
- Receives base64-encoded screenshot
- Returns: `playerName`, `setName`, `year`, `cardNumber`, `variant`, `gradingCompany`, `grade`, `certNumber`
- Model: `claude-haiku-4-5-20251001`

### CardHedger API — lookup step

| Endpoint | Purpose | When used |
|---|---|---|
| `POST /v1/cards/prices-by-cert` | Cert identity + that slab's specific sale history | When cert number is extracted |
| `POST /v1/cards/card-search` | Free-text card search by player/set/year | Always (fallback or primary) |
| `POST /v1/cards/all-prices-by-card` | Grade-level price estimates (28 grades) | Always after card_id found |
| `POST /v1/cards/comps` | Recent actual sales (90-day window) | Always after card_id found |

---

## Lookup Logic

```
if cert number present:
  → POST /v1/cards/prices-by-cert
  → if prices[] is empty (common — cert-level data often absent):
      show amber notice
      fall through to name search
  → else: display cert-specific sale history

name search (always runs for grade prices + comps):
  → build query: [playerName, year, setName, cardNumber, variant].join(' ')
  → POST /v1/cards/card-search → take cards[0]
  → parallel: all-prices-by-card + comps (90d, matched grade, 20 results)
  → display grade prices table + comps table
```

**Key insight:** `prices-by-cert` returns sale history for that specific physical slab, not aggregate market data. Most certs have empty price history. Grade-level price estimates (`all-prices-by-card`) and recent comps are the primary pricing signal.

---

## UI Layout

### Left panel — Input
- Screenshot upload dropzone (drag-and-drop or click)
- Thumbnail preview of uploaded image
- Extracted fields (editable): Player, Year, Set Name, Card #, Variant, Grading Co., Grade, Cert #
- Cert badge (PSA / BGS / SGC + number) shown when cert was found
- CTA button: "Parse with AI" → "Look Up by Cert" / "Search by Name"
- Warning when no cert found (falls back to name search)

### Right panel — Results
- Amber notice when cert fallback triggered
- **Card identity card:** card image (when available), player name, set/year/number/variant, grade badge
- **Price summary row:** Fair Value (matched grade) + Last Sale (Exact Cert)
- **Max Bid Calculator:** margin % input → live ceiling calculation
- **Grade Prices table:** all grades from `allPrices`, matched grade highlighted in blue
- **Recent Comps table** (when available): sale price, grade, date, platform

---

## Max Bid Calculator

```
maxBid = fairValue × (1 - margin / 100)
```

- `fairValue` = matched grade price from `allPrices`, or average of cert-specific sales
- Default margin: 20%
- Updates live as margin input changes

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Cert found, no price history | Amber notice; auto-falls back to name search |
| Card not found in CardHedger | Error message: "No matching card found" |
| API route crash | Top-level try/catch returns `{ error: "..." }` JSON — no empty 500 body |
| Claude parse failure | Parse error displayed inline; user can retry |
| `comps` returns null | Comps section hidden; grade prices still shown |

---

## Files

| File | Purpose |
|---|---|
| `app/admin/card-lookup/page.tsx` | Client component — full UI |
| `app/admin/card-lookup/error.tsx` | Error boundary — surfaces actual JS errors |
| `app/api/admin/card-lookup/route.ts` | POST handler — three action modes: `parse`, `cert`, `price` |
| `lib/cardhedger.ts` | `pricesByCert()` added alongside existing search/prices/comps functions |
| `app/admin/layout.tsx` | Card Lookup nav link added (ScanLine icon) |

---

## Known Limitations

- **Cert-level sale history is sparse** — CardHedger only has data for certs that have transacted on platforms they track. Most lookups will hit the name-search fallback.
- **Card image availability varies** — some cards in CardHedger's catalog lack images.
- **Comps window is 90 days, grade-matched** — low-pop cards or rare grades may return no comps.
- **Name search takes top result** — if the extracted set name is ambiguous, the wrong card may be returned. Extracted fields are editable to allow correction before re-running.
