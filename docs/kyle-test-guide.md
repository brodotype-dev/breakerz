# BreakIQ — Quick Test Guide

**For:** Kyle
**From:** Brody
**Last updated:** 2026-05-05

---

## What you're testing

We just shipped a real Privacy Policy + Terms & Conditions and gated signup behind an acceptance checkbox. Before we open the gates wider, I'd love a 10-minute smoke test of the full path: invite link → signup → onboarding → playing with the product → profile.

You're hitting **production** (`getbreakiq.com`), so anything you do is real. Use the invite code below — it's one-time-use and tied to a throwaway QA row, so don't worry about polluting prod data.

---

## Step 1 — Sign up

1. Open this link: **https://www.getbreakiq.com/auth/signup?code=qa-c6fd934b**
2. You'll see a "Hey [name], you're in" screen.
3. **The new bit:** there's a checkbox above the sign-in buttons that says
   _"I'm 18 or older and I agree to the Terms & Conditions and Privacy Policy."_
   - Try clicking the buttons **without** ticking the box → they should be disabled.
   - Try the email-signup form without ticking → same thing.
   - Click each link (Terms, Privacy) → both should open in new tabs and render real legal copy.
4. Tick the box, then sign up with **whichever Google or Discord account you want** — the OAuth email doesn't have to match the waitlist row, the code itself is the gate.

If anything in steps 1–4 feels weird, screenshot it. That's the highest-signal feedback.

---

## Step 2 — Onboarding wizard

After OAuth, you'll land in a 3-step onboarding flow:

1. Age gate (Yes / No — pick Yes, you're testing the happy path)
2. About-you (sports, eras, primary platform, monthly spend)
3. Attribution + best pull (free-text)

Onboarding is unchanged from before, but eyeball it for anything broken.

---

## Step 3 — Use the product

Hit `/` (the home page). You should see the **Active Products** grid — searchable, filterable by sport / year / lifecycle. Pick one of the live products and click in.

Things worth poking at:

- **`/break/[slug]`** — the consumer break page. Look at the slot pricing, BUY/WATCH/PASS signal, player drawer (click a player row), risk-flag pills, hype chips. Anything that looks wrong or surprising is worth flagging.
- **`/analysis`** — BreakIQ Sayz. Pick a product, configure cases (hobby/BD/jumbo counters), select teams + extra players, plug in an asking price, hit Analyze. Should give you a fair-value estimate + signal.
- **`/card-lookup`** — Slab Analysis. Either upload a screenshot of a graded card from eBay/Whatnot/etc. or type in a PSA cert number directly. Should pull back PSA pop data + CardHedger comp pricing.

You'll burn a free analysis each time you use `/analysis` or `/card-lookup` — you've got 3 lifetime free analyses on the QA account; that's plenty for one pass.

---

## Step 4 — Check the profile audit trail

Hit `/profile`. There's a new **Legal** section near the bottom showing:

- Terms & Conditions — Accepted [today's date] · version 2026-05-05
- Privacy Policy — Accepted [today's date] · version 2026-05-05

Both should show green "Accepted" pills. If either says "Not accepted" or "Update available" instead, that's a bug.

---

## What I'm specifically watching for

In rough priority order:

1. **The acceptance gate is bulletproof.** No way to sign up without ticking the box, on any browser, on any signup path (Google / Discord / email).
2. **The legal pages render cleanly.** Markdown formatting, table on the subprocessor list, headers, the "Last updated" timestamp.
3. **The /profile audit trail matches your acceptance.** Date and version should both be there.
4. **General product polish.** Anything that looks off — broken layouts, weird copy, slow loads, math that seems wrong.

---

## How to send feedback

Easiest is just to text me with screenshots — I'll triage on my end. If you'd rather drop notes in `#breakiq-insights` or shoot me an email, also fine.

If you find something gnarly that needs me to repro, include the URL, the browser, and what you clicked. The Discord `/insight` flow is **not** the right channel for bug reports — that one's for player/product intel, not app bugs.

---

## Heads up

- This is private beta — don't share the link or the code outside our group yet.
- The legal docs are still draft pending attorney review (you'll see a "Draft notice" callout at the top of each page). The language is close-to-final but a lawyer will tighten it.
- If you want to sign up a second time on a different Google/Discord account, ping me — I'll spin you another invite code in 10 seconds.

Thanks for the gut-check.
