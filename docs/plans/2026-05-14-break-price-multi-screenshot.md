# `/break-price` multi-screenshot capture

*Status: planned 2026-05-14. Not yet shipped.*

## Context

Today `/break-price` accepts one `screenshot` attachment per invocation. When Brody is watching a stream and wants to capture three or four price tells from the same break, he has to fire the command three or four times — each one stages its own `pending_insights` row and needs its own ✅ confirm.

Real workflow: open Whatnot, screenshot 3-5 listings in a 5-minute window, dump them. Multi-fire works but adds friction (3-5 confirms instead of 1) and breaks the "one observation moment = one entry" mental model when the screenshots are about the same break.

Goal: capture N screenshots in one user gesture, parse them as one batch, surface one ✅/❌ proposal that lists every row Claude found across all images.

## Approach — message context-menu command (recommended)

Discord has two interaction types beyond slash commands: `USER` context menu and `MESSAGE` context menu. A `MESSAGE` command appears under right-click → Apps (long-press → Apps on mobile) and gives the handler the full message payload — including **all attachments on that message**, up to Discord's 10-per-message cap.

**Why this over numbered slash slots (`screenshot1`, `screenshot2`...):**
- Mobile UX. Slash-command attachment options are per-option file pickers — picking 5 screenshots = 5 separate gallery dives. Composing one message with 5 images = one multi-select gallery dive.
- No new option per format. We pick up to 10 attachments per message "for free" without growing the command surface.
- Composability with the existing slash command. Same user, same allowlist check, same parse → propose → confirm flow. Just a different entry point.

**Why this over a thread-based flow:**
- No new state. A thread-based collector needs DB-backed "session in progress" tracking and a window for posts. Context menu is fully stateless — message exists, command fires against it, done.
- No bot-permission expansion. Reading attachments on a message that's the target of a MESSAGE command doesn't require `READ_MESSAGE_HISTORY` intent.

### Mechanics

1. **Register new command** in [scripts/register-discord-commands.mjs](../../scripts/register-discord-commands.mjs):
   ```js
   {
     name: 'Capture as /break-price',
     type: 3,                    // MESSAGE context menu
     dm_permission: false,
   }
   ```
   Name shows in the Apps submenu — keep it short. Top-level command types: `1` chat input (slash), `2` user menu, `3` message menu. No options array — the target message is implied by `data.target_id`.

2. **Dispatch in** [app/api/discord/interactions/route.ts](../../app/api/discord/interactions/route.ts) — add a branch alongside the existing slash-command branch. When `interaction.type === 2` (APPLICATION_COMMAND) AND `data.type === 3` (MESSAGE menu) AND `data.name === 'Capture as /break-price'`, route to `handleBreakPriceFromMessage(interaction)`.

3. **`handleBreakPriceFromMessage`** mirrors `handleBreakPrice` from [app/api/discord/interactions/route.ts:362](../../app/api/discord/interactions/route.ts), with three differences:
   - Source attachments come from `interaction.data.resolved.messages[targetId].attachments` (array of Discord attachments).
   - Source narrative comes from `interaction.data.resolved.messages[targetId].content` (the user's message text).
   - No `product` autocomplete option — context menu commands can't have options. Product resolution falls back to (a) the narrative naming a product, (b) Claude vision reading the image.

4. **Reject** when:
   - Zero image attachments on the message (`No screenshots on this message — add them as attachments and try again.`).
   - >5 images (`Pick a message with ≤5 attachments to keep parsing tight.`). Soft cap; Discord allows 10. 5 keeps Claude latency reasonable and the proposal preview from blowing the 2000-char cap that already bit us on the 18-team sheet (see [app/api/discord/interactions/route.ts:132](../../app/api/discord/interactions/route.ts)).

5. **Image fetch + size check** — reuse the per-attachment validation from `handleBreakPrice` (5 MB cap, valid MIME types). Done in parallel via `Promise.all` across the attachment array. Failed fetches reported by index in a single error message; one bad image doesn't kill the others.

## Parser change

`parseBreakPrice` in [lib/insights-parser.ts](../../lib/insights-parser.ts) takes a single `imageBase64`. Extend it:

```ts
interface BreakPriceInput {
  narrative?: string;
  notes?: string;
  productId?: string;
  // Existing single-image path — keep so /break-price slash command
  // works unchanged.
  imageBase64?: string;
  imageMediaType?: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  // New: multi-image path used by the context-menu command. When set,
  // imageBase64/imageMediaType are ignored.
  images?: Array<{
    base64: string;
    mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  }>;
}
```

Inside the function, the Claude content array becomes:
- N image blocks (one per image), in upload order
- One text block with the narrative + notes + active products + parser instructions

Claude vision handles multi-image natively; we already do this elsewhere (e.g. slab analysis). Cost: ~$0.002 per image with Haiku 4.5, so 5 images = ~$0.01 per invocation. Negligible.

Prompt addendum: tell Claude to treat the images as one capture session ("these are screenshots from the same break / same listing batch — extract every distinct slot ask across all of them, dedupe identical rows"). Keeps it from collapsing repeated team rows that appear in two different shots.

## Proposal preview

One pending_insights row per emitted ParsedUpdate, identical to today. The bot reply changes only in:
- Narrative line: `_(message context menu · 4 screenshots)_` instead of `_(screenshot only: filename.png)_`.
- Truncation salvage path already handles N-row proposals; nothing new there.

## Out of scope

- **Slash command numbered slots** (`screenshot2`, `screenshot3`...). Mentioned earlier as the dumb-but-mechanical alternative. Skip — the context menu UX is meaningfully better and not much harder to ship.
- **Thread-based collector.** Skip — needs session state we don't have a use for elsewhere.
- **Replying to a message with the slash command.** Discord doesn't expose the replied-to message in slash interactions, so this isn't viable without a different command type. Context menu is the right primitive.
- **Auto-dedupe across screenshots within one parse.** The prompt hint covers the common case; if duplicates leak, they can be ❌'d individually at confirm time. Aggressive dedupe is over-engineering for slice 1.
- **Multi-image support on the existing `/break-price` slash command.** Could add but doesn't pull weight — anyone wanting multi-image has the context menu.

## Files touched

| File | Change |
|---|---|
| [scripts/register-discord-commands.mjs](../../scripts/register-discord-commands.mjs) | Register the new MESSAGE context-menu command |
| [app/api/discord/interactions/route.ts](../../app/api/discord/interactions/route.ts) | Add MESSAGE-menu branch → new `handleBreakPriceFromMessage` |
| [lib/insights-parser.ts](../../lib/insights-parser.ts) | Extend `BreakPriceInput` with optional `images: Array<...>`; thread through to Claude content array |

No DB migrations, no API routes, no schema changes. Same `pending_insights` + ✅/❌ flow.

## Operational

1. Apply code, deploy.
2. Re-run [scripts/register-discord-commands.mjs](../../scripts/register-discord-commands.mjs) so Discord picks up the new context-menu command. Existing `/break-price` slash command is untouched.
3. In Discord, compose a message with 2-5 image attachments and arbitrary text (or no text). Long-press / right-click the message → Apps → "Capture as /break-price". Bot replies with proposal, ✅ to apply.
4. Smoke test against [app/admin/market-delta/page.tsx](../../app/admin/market-delta/page.tsx) — captures panel should show all the new observations with the expected `Δ vs model` deltas.

## Effort

~3-4 hours. Most of it is duplicating + adjusting `handleBreakPrice`. The parser change is mechanical. No new dependencies, no schema work, no client surface change.

## Risks

- **Discord rolls out the context menu in their mobile clients inconsistently.** Mobile support for MESSAGE commands has been stable since 2023 but worth a quick check on iOS/Android once before depending on it for the primary path.
- **5-image cap is arbitrary.** If Brody starts hitting it routinely on long sessions, bump to 10 and let Claude latency speak for itself. Single-knob change.
- **Truncation salvage on N-image proposals.** The existing salvage path handles N rows fine, but a 5-image capture could realistically emit 30+ rows. Worth eyeballing the first few real proposals to make sure preview text stays readable.
