# PRD: Bulk Product Import

**Created:** 2026-03-27
**Status:** Draft — Pending Review

---

## Problem

Creating products one at a time through the admin UI is workable for 1–2 products but doesn't scale. Ahead of Beta launch, we need to onboard a significant number of products in a short window. The current flow requires ~5 manual steps per product (create → import checklist → run matching → import odds → review). For 10–20 products, that's a full day of repetitive clicking.

---

## Goal

Allow an admin to upload all files for multiple products at once and have the system run the full import pipeline — product creation, checklist import, CardHedger matching, and odds import — with minimal manual intervention. Unmatched variants are expected and cleaned up afterward on individual product dashboards.

---

## Non-Goals

- Full zero-touch automation. CardHedger matching will still produce unmatched variants; this tool doesn't attempt to resolve them during import.
- Consumer-facing. Admin only.
- Replacing the single-product wizard. That stays for one-off imports.

---

## User Flow

1. Admin navigates to `/admin/bulk-import`
2. Downloads (or references) the manifest template — a CSV with one row per product
3. Fills in product metadata for each product
4. Uploads the manifest + all checklist files + any odds PDFs in a single drag-drop zone
5. System auto-pairs files to manifest rows by filename
6. Admin reviews the pairing table, fixes any mismatches, then clicks **Run Import**
7. A live status table shows progress per product as each stage completes
8. When all products finish, admin sees a summary: X created, X matched, X unmatched variants requiring review

---

## Manifest Format

CSV file — one row per product. Filename: anything (system detects by `.csv` + header row).

| Column | Required | Notes |
|---|---|---|
| `name` | ✅ | Full product name (e.g. `2025 Bowman Chrome Baseball`) |
| `year` | ✅ | 4-digit year |
| `sport` | ✅ | `baseball`, `basketball`, `football` |
| `manufacturer` | ✅ | `Topps`, `Panini`, `Upper Deck`, etc. |
| `slug` | ✅ | URL slug — must be unique (e.g. `2025-bowman-chrome-baseball`) |
| `hobby_case_cost` | ✅ | Numeric, no $ sign |
| `bd_case_cost` | ❌ | Optional |
| `checklist_file` | ✅ | Filename of the matching checklist (CSV or PDF) |
| `odds_file` | ❌ | Filename of the matching odds PDF — leave blank if none |
| `status` | ❌ | `active` or `draft` (default: `draft`) |

**Example:**
```
name,year,sport,manufacturer,slug,hobby_case_cost,checklist_file,odds_file,status
2025 Bowman Chrome Baseball,2025,baseball,Topps,2025-bowman-chrome-baseball,2400,bowman-chrome-checklist.csv,bowman-chrome-odds.pdf,draft
2025 Topps Series 1 Baseball,2025,baseball,Topps,2025-topps-series-1,1800,topps-s1-checklist.csv,,draft
```

---

## File Pairing Logic

1. Parse manifest first
2. For each row, look for a file in the upload set whose name matches `checklist_file` exactly (case-insensitive)
3. Same for `odds_file`
4. Show pairing results in a preview table before running:
   - ✅ Manifest row + checklist found (+ odds if specified)
   - ⚠️ Manifest row found but checklist file missing
   - ⚠️ File uploaded but not referenced in manifest (orphan — warn, don't import)
5. Block **Run Import** if any required checklist is missing

---

## Import Pipeline (per product, sequential)

Each product runs all stages before moving to the next.

| Stage | What happens | Failure behavior |
|---|---|---|
| **1. Create product** | Insert into `products` table | Skip remaining stages, mark row failed |
| **2. Parse checklist** | Call checklist parser (existing logic) | Mark row failed, skip |
| **3. Import players/variants** | Upsert players, player_products, variants | Mark row failed, skip |
| **4. Run CardHedger matching** | Chunked matching — existing `/api/admin/match-cardhedger` | Partial match OK — log unmatched count, continue |
| **5. Import odds** | Parse odds PDF + apply to variants — existing `/api/admin/parse-odds` + `/api/admin/apply-odds` | Non-fatal — log warning, continue |
| **6. Set status** | Mark product `active` or `draft` per manifest | — |

Products run **sequentially**, not in parallel — CardHedger matching is the bottleneck and parallel requests would likely hit rate limits.

---

## UI: Status Table

Each product gets a row. Columns: product name, and one status cell per stage.

| Product | Create | Checklist | Matching | Odds | Result |
|---|---|---|---|---|---|
| 2025 Bowman Chrome | ✅ | ✅ | ⚠️ 14 unmatched | ✅ | Draft |
| 2025 Topps S1 | ✅ | ✅ | ✅ 0 unmatched | — | Draft |
| 2024 Prizm Basketball | ❌ slug conflict | — | — | — | Failed |

Status values:
- `—` Pending
- Spinning indicator — In progress
- ✅ Done
- ⚠️ Done with warnings (e.g. unmatched variants)
- ❌ Failed (with short error message)

After completion: a **summary bar** at the top — "3 products created · 2 fully matched · 1 needs odds · 14 variants need review" — with links to product dashboards for cleanup.

---

## New Files

| File | Purpose |
|---|---|
| `app/admin/bulk-import/page.tsx` | Client component — manifest upload, file pairing preview, run button, live status table |
| `app/api/admin/bulk-import/route.ts` | POST: orchestrates the pipeline per product, streams progress via SSE or returns job status |

**AdminNav addition:** Add "Bulk Import" link under "New Product"

---

## Streaming vs. Polling

CardHedger matching can take 30–90s per product. Two options:

- **Server-Sent Events (SSE):** API streams progress events as each stage completes. Frontend updates the table in real time. Cleaner UX, slightly more complex.
- **Polling:** API starts a job, returns a job ID. Frontend polls `/api/admin/bulk-import/[jobId]` every 2s for status. Simpler, works within Vercel's function timeout constraints.

**Recommendation: Polling.** Vercel serverless functions have a 60s timeout on the hobby plan. A 10-product import with matching could run 10–15 minutes total — polling with a persistent job store (Supabase table) is safer than a long-lived SSE connection.

---

## New DB Table (for job tracking)

```sql
CREATE TABLE bulk_import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'complete', 'failed')),
  products JSONB NOT NULL  -- array of { name, stage, result, error, unmatched_count }
);
```

Frontend polls `/api/admin/bulk-import/[jobId]` until `status = complete`.

---

## Open Questions

1. **Slug conflicts:** If a slug already exists, should we skip that product and continue, or abort? (Recommendation: skip + warn)
2. **Duplicate product names:** Same name + year combination already in DB — same question.
3. **Manifest template:** Should we serve a downloadable template CSV from the page, or just document the format?
4. **Max products per run:** Should we cap at, say, 25 per batch to avoid runaway jobs? Probably yes.

---

## Verification Checklist

- [ ] Upload manifest + 3 checklist files + 1 odds PDF → pairing preview shows correct matches
- [ ] Missing checklist file → Run Import button disabled, warning shown
- [ ] Orphan file (not in manifest) → warning shown, not imported
- [ ] Run import → all 3 products created, matching runs, status table updates per stage
- [ ] Slug conflict → product skipped, row shows ❌ with "slug already exists"
- [ ] Odds stage skipped for product with no odds file → no error
- [ ] After completion → summary bar links to each product dashboard
