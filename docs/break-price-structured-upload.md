# `/break-price` structured JSON upload (the escape hatch)

The inline `/break-price` parser runs an LLM (vision or tabular) inside Discord's function window. A very large capture — e.g. a **75-row price sheet** — emits ~11-15K tokens of JSON, which overruns the token budget / time and times out (see CHANGELOG 2026-06-09 / 06-16).

**Escape hatch:** produce a structured **`.json`** file of the slot asks *offline* (no time limit) and upload it. BreakIQ ingests it **deterministically — no LLM call** — resolving names→ids against the active roster. Instant, unbounded by row count.

```
/break-price  product:<pin the product>  file:<asks.json>
```

Pin the product with the `product` autocomplete option (or set `product` in the JSON). The proposal posts with **✅ Apply / ❌ Discard** — same review + apply path as every other capture. (No ✏️ Refine — it re-runs the LLM, which doesn't apply to a deterministic upload; fix the JSON and re-upload instead.)

## JSON schema

Either a bare array of rows, or a wrapped object:

```json
{
  "product": "2025-26 Topps Chrome Cactus Jack Basketball",
  "source": "stream_ask",
  "source_note": "Whatnot Sunday break",
  "rows": [
    { "scope": "team",   "team": "Boston Celtics",  "price": 4299, "format": "hobby" },
    { "scope": "player", "player": "Cooper Flagg",  "price_low": 2400, "price_high": 2600 },
    { "scope": "player", "name": "Victor Wembanyama", "price": 8799 }
  ]
}
```

Per-row fields (all lenient):

| field | notes |
|---|---|
| `scope` | `"team"` or `"player"`. Optional — if omitted, BreakIQ infers from `team`/`player`/`name`. |
| `team` / `player` / `name` | The entity. Use the canonical name; `name` is a catch-all matched against teams first, then players. |
| `price` **or** `price_low` + `price_high` | Integer dollars. `price` sets both (single ask); use the pair for a range. |
| `format` | `"hobby"` (default) / `"bd"` / `"jumbo"`. Or pass a full `composition` object (`{ "bd": 20, "hobby": 5 }`) for mixes. |
| `product` | Per-row override; defaults to the pinned product / doc-level `product`. |
| `source` / `source_note` | Per-row override of the doc-level values. |

Doc-level `product` / `source` / `source_note` apply to every row unless overridden.

## Resolution rules (deterministic)

- **Product:** pinned `product` option → doc `product` → per-row `product`. Matched normalized-exact, then unique-substring. No match → all rows dropped with a reason.
- **Team:** matched against the canonical `players.team` values in that product's roster.
- **Player:** matched normalized against that product's roster. **Ambiguous or unmatched names are dropped, never guessed** (wrong attribution is worse than a gap). The drop reasons are surfaced in the Discord reply.
- **Composition / price / source** validated the same way as the LLM path.

## Producing the JSON offline

Run the messy capture (screenshot, pasted sheet, DM text) through Claude with a prompt like *"Convert this break price sheet into the BreakIQ `/break-price` JSON schema — one row per team/player slot, canonical names, integer prices"*, save the result as `asks.json`, and upload it. For a clean Google Sheet you can skip Claude and hand-build the JSON (or export CSV and use the `file:` tabular path for smaller sheets).

## Why a separate path (not just bigger timeouts)

The inline LLM path is bounded by output tokens + the 300s function cap; past ~90 rows it can't finish. The structured path moves the expensive extraction *out* of that window and reduces ingest to a deterministic DB lookup — so it scales to any sheet size. Keep the inline screenshot path for quick small/medium captures; use this for big-or-failed ones.
