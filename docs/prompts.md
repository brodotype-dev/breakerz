# Prompt index

Every place BreakIQ sends text to Claude, what it is for, and where to read the live wording.

**This is an index, not a copy.** The prompts stay inline next to the code that builds them — most are template literals that interpolate a roster, a product list or a break config, so a pasted copy here would be wrong within a week. Follow the `file:line` to read the real thing.

Model and effort both come from [`lib/models.ts`](../lib/models.ts): one `MODELS` key and one `EFFORT` key per task. Changing a model or a thinking budget is an edit there, never at a call site.

Everything runs **Sonnet 5.5 at `low` effort** as of 2026-11-20. Low because this work is extraction and classification against tight output budgets, not reasoning. The two worth re-checking if quality dips are `verdict` and `configurator` — they produce prose, the rest fill in fields.

---

## The two that matter most

### 1 · Insight parse — Discord `/insight`
`lib/insights-parser.ts:440` · `parseInsights()` · `matcher` · max_tokens 2048 (8192/16000 on image or web input)

Turns an SME's narrative, screenshots, or a scraped page into proposed DB updates: sentiment, asking price, hype tag, risk flag, odds observation. Nothing it emits is written directly — everything lands in `pending_insights` behind the ✅/✏️/❌ confirm flow.

Rule blocks worth knowing, by line:
- **`TWO-TIER ROSTER` (~450)** — default tier is players in an active product (valid for every update kind); `*risk-only` tier is players with card history but no active product (RISK_FLAG only). Lets us capture an injury for someone who'll matter next season.
- **`CRITICAL` (~579)** — the nickname table (Wemby, Luka, Shedeur, Flagg…) and the anti-substitution rules. This block exists because of the Wemby misattribution incident.
- **Contributor correction** — when a ✏️ Refine comes back, the correction is rendered as authoritative and overrides the model's earlier pick.

**This is the file CLAUDE.md means by "edit the parser rules."** Scoring guidance, new hype categories, new risk types all live here.

### 2 · Break-price parse — Discord `/break-price`
`lib/insights-parser.ts:1433` · `parseBreakPrice()` · `matcher` · max_tokens 16000, streamed, single 220s attempt

Reads a breaker's price sheet — usually screenshots — into one `asking_price` row per team or player slot. Emits only asking prices; never sentiment.

- **`PRICE SHEET RULES` (~1462)** — composition inference, the title-level format override ("JUMBO" in a break title), and the available-formats rule that supersedes it when the product is hobby-only.
- **Tightest path in the system.** One attempt, no retries, inside a 300s function cap. If a big sheet ever stops parsing, this is why, and `parseBreakPriceJson` is the no-LLM escape hatch.

---

## The rest

| What | Where | Key | max_tokens | Notes |
|---|---|---|---|---|
| **Verdict** — the BUY/HOLD/PASS take | `lib/analysis.ts:~540` | `verdict` | 350 | **The only user-facing prose we generate.** Asks for 2–3 plain sentences, no markdown. Gets fair value, ask, signal, top players, risk flags. When the observation flag is on, recent competitor asks are spliced in with grounding rules: never name a breaker or platform, never invent an observation. |
| **Card match** — the Claude rung | `lib/cardhedger.ts:~790` | `cardMatch` | 128 | Last resort in the match ladder, after exact/synonym/number/card-code all miss. Gets numbered candidates, returns JSON only (`card_id` + confidence, or null). The `description` field is the documented tie-breaker for two cards sharing set+number+variant (the Murakami base RC vs. Red Rookie Redemption case). |
| **Editorial extract** | `lib/editorial-parser.ts:91` | `extract` | 2048 | Reads a Beckett/Topps-style article. Deliberately fenced: may emit **only** market-observation kinds, never sentiment and never prices. |
| **Slab / listing parse (vision)** | `app/api/card-lookup/route.ts:55` | `extract` | 300 | Pulls card details off an auction screenshot or cert image before PSA verification. |
| **Bets debrief — per product** | `app/api/admin/parse-bets-debrief/route.ts:53` | `extract` | 1024 | Turns a written debrief into per-player structured rows. |
| **Bets debrief — global** | `app/api/admin/parse-bets-global/route.ts:32` | `extract` | 1024 | Same, across all players and products. |
| **Anchor configurator** | `app/api/admin/anchor-config/route.ts:389` | `configurator` | 1536 | The only true back-and-forth chat. Takes a plain-English description of which variants should anchor a product's pricing and proposes regex patterns, drawing on manufacturer-specific `anchorConcepts`. Uses a real `system:` prompt; the others put everything in the user turn. |

---

## No evals

There is no automated eval suite. Every prompt change has been validated by running real captures through it and reading the output. That has been adequate at current volume and will not stay adequate — the failure mode it misses is the quiet one, where a prompt gets *slightly* worse at a rare case and nobody notices until a user does.

If and when that gets built, the raw material already exists: `pending_insights` retains every capture with its parsed result and whether a human applied, refined, or discarded it. That is a labelled dataset of real inputs and human verdicts, sitting in the database.
