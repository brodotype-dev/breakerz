# BreakIQ Privacy Policy

**Last updated:** May 4, 2026
**Effective date:** [TO BE SET AT LAUNCH]

> **Draft notice.** This document is a working draft prepared for legal review. Bracketed items marked `[…]` are placeholders that the operator will confirm with counsel before publication. Nothing in this draft is legal advice.

This Privacy Policy explains how Mervin LLC ("**BreakIQ**", "**we**", "**us**") collects, uses, shares, and protects information when you use BreakIQ — the sports card break pricing and analysis service available at `getbreakiq.com` (the "**Service**").

By using the Service you agree to this Privacy Policy and to the [Terms & Conditions](./terms-and-conditions.md).

---

## 1. Who we are

The Service is operated by **Mervin LLC** (a Pennsylvania limited liability company), doing business as BreakIQ. References to "BreakIQ" in this policy refer to that entity.

If you have any questions about this policy or want to exercise a privacy right, contact us at **support@getbreakiq.com**.

---

## 2. Scope

This policy applies to information we collect through:

- The BreakIQ website and web app at `getbreakiq.com`.
- The BreakIQ-operated Discord bot and `#breakiq-insights` channel for allowlisted contributors.
- Email communications we send (waitlist invites, account, billing, and product notices).

This policy does **not** cover third-party platforms you may reach from BreakIQ, including Whatnot, Fanatics Live, eBay, Layton Sports Cards, Dave & Adam's, or local card shops. Sports card breaks themselves are run by third-party "breakers" on those platforms; their privacy practices are their own.

---

## 3. Information we collect

### 3.1 Account information

When you sign up — through email/password, Google, or Discord OAuth — we collect:

- Email address.
- Name and profile picture if provided by your OAuth provider.
- A hashed password (only if you sign up with email/password; we never see your plaintext password).
- Your OAuth provider's user identifier.

We store this in our authentication system (Supabase Auth) and a linked profile record.

### 3.2 Profile and onboarding information

After sign-up we collect, only what you choose to enter, in our 3-step onboarding wizard and on your `/profile` page:

- First and last name.
- A self-attested confirmation that you are 18 or older. **We do not store your date of birth.** Your browser computes whether the date you entered is 18+ and only sends us that yes/no answer.
- Hobby preferences: favorite sports, teams and players you are chasing, collecting eras, experience level, primary breaking platform, monthly hobby spend range, how you heard about us, and an optional "best pull" free-text answer.

This information is used to personalize the Service and to inform our internal product analysis.

You can view and edit most of these fields at any time on your profile page.

### 3.3 Waitlist information

If you submit the public waitlist form, we collect your email address, optional full name, and an optional free-text "use case" answer.

### 3.4 Subscription and billing information

If you subscribe to a paid plan, we collect:

- Your Stripe customer ID and subscription ID.
- Your current plan (Free, Hobby, or Pro), subscription status, and current billing-period end date.
- Counters of how many analyses you have used in the current period.

**We do not store credit card numbers, bank account details, or any other payment-instrument data.** All payment data is handled by Stripe under Stripe's privacy policy.

### 3.5 Break logs ("My Breaks")

When you log a break, we store the analysis snapshot at the moment of logging, the platform you used, the price you paid, the number of cases, the team or players involved, your outcome rating (Win / Mediocre / Bust), free-text outcome notes, and feedback about whether the analysis was helpful.

Your break logs are private to your account by default and protected by row-level security in our database.

### 3.6 Card-lookup uploads (Slab Analysis)

When you upload an image of a card or slab, the image is sent to Anthropic's Claude API for parsing and to PSA's public API for verification (when a PSA cert number is detected). **We do not retain your uploaded images.** They exist only for the duration of the request.

Please do not upload images that contain unrelated sensitive personal information (driver's licenses, passports, financial documents, photographs of minors, etc.). The Service is designed for sports cards.

### 3.7 Discord contributor information

If you are an allowlisted contributor in the BreakIQ Discord, when you submit `/insight`:

- Your Discord user ID, display name, and the raw narrative you typed are stored.
- Confirmed insights become part of the consumer-facing product, with attribution to your Discord display name.

By posting in `#breakiq-insights`, you agree that your submissions and your Discord display name may be visible to other authenticated BreakIQ users as part of the analysis surfaces.

### 3.8 Automatically-collected information

When you use the Service we automatically collect:

- Authentication session cookies (HttpOnly, set by Supabase Auth).
- Product analytics events via PostHog (such as `user_signed_up`, `onboarding_completed`, `subscription_activated`). PostHog is reverse-proxied through `getbreakiq.com/ingest` so your browser does not contact a third-party analytics domain directly.
- Server access logs from our hosting provider, Vercel (request paths, status codes, IP addresses, user-agent strings) — used for security, abuse prevention, and debugging.

We do not run third-party advertising cookies or sell behavioral data.

---

## 4. How we use information

We use the information described above to:

- Provide, secure, and operate the Service.
- Authenticate you and manage your account.
- Run our subscription, billing, and usage limits.
- Personalize analyses based on your stated preferences.
- Send you transactional emails (waitlist invites, account, billing, security, and important product notices).
- Detect, investigate, and prevent fraud, abuse, and violations of our Terms.
- Diagnose problems and improve the Service.
- Comply with legal obligations.

We do not use your personal information to train third-party AI models. We do send certain transient inputs (card images, Discord narratives, card descriptors) to Anthropic's Claude API to power product features — see Section 5.

---

## 5. Subprocessors and data sharing

We share information with the following third-party service providers ("**subprocessors**") who help us operate the Service:

| Subprocessor | Purpose | What we share |
|---|---|---|
| Supabase | Authentication and primary database hosting | All account, profile, break-log, waitlist, and contributor data |
| Stripe | Payment processing and subscription management | Your user ID, plan, and email; Stripe holds your payment-instrument data |
| Anthropic (Claude API) | AI parsing of card-lookup images, Discord insight narratives, and CardHedger card-matching | The transient image, narrative, or card descriptor required for the request |
| CardHedger | Sports card pricing, comp data, and catalog | Card descriptors only — no user data |
| PSA (Professional Sports Authenticator) | Cert verification and population data | Cert numbers only — no user data |
| Resend | Transactional email delivery | Recipient email and email content |
| PostHog | Product analytics | Pseudonymous user ID and event metadata |
| Discord | OAuth sign-in and bot interactions | Discord user ID and content of `/insight` submissions |
| Google | OAuth sign-in only | What Google chooses to share with us per the scopes you approve (typically email, name, avatar) |
| Vercel | Hosting, edge logging, and scheduled jobs | All request and runtime data |

We may also share information:

- With law enforcement or other parties if required by law, subpoena, or court order, or to protect our rights, the Service, or other users.
- In connection with a merger, acquisition, financing, or sale of assets — subject to standard confidentiality protections.
- With your consent, or at your direction.

**We do not sell your personal information.**

---

## 6. Cookies and similar technologies

We use a small number of strictly-necessary and analytics cookies:

- A Supabase Auth session cookie to keep you signed in (HttpOnly, secure).
- A PostHog analytics cookie to attribute product events.

We do not use cross-site advertising cookies. You can disable cookies in your browser, but signing in will not work without the session cookie.

---

## 7. Data retention

- **Account and profile records** — retained while your account is active. If you request deletion, we delete or anonymize your account data within 30 days, except where we are required to retain it for legal, tax, or fraud-prevention purposes.
- **Waitlist entries** — retained until you ask us to remove them or until we determine the entry is no longer relevant.
- **Break logs** — retained while your account is active and deleted when your account is deleted.
- **Pending Discord insights** — automatically expire 24 hours after submission if not confirmed.
- **Market observations** (asking-price and hype-tag entries) — automatically expire 14 days after observation.
- **Risk flags and sentiment history** — retained as part of the historical analysis record. Confirmed contributions remain associated with your Discord display name even after your account is deleted, unless you ask us to remove specific entries.
- **Server logs and analytics** — retained for up to [12 months] for security, abuse prevention, and product analysis.

---

## 8. Your rights and choices

Depending on where you live, you may have rights to:

- Access the personal information we hold about you.
- Correct inaccurate information (most fields are editable in your profile).
- Delete your account and associated personal information.
- Object to or restrict certain processing.
- Receive a portable copy of your data.
- Withdraw consent where we rely on consent.

To exercise any of these rights, email us at **support@getbreakiq.com**. We will respond within 30 days. We may need to verify your identity before acting on a request. Account deletion currently runs through us — there is no in-app self-serve "delete my account" button yet, so please email us and we will handle it.

### California residents (CCPA/CPRA)

You have the right to know what personal information we collect, to request deletion, to correct inaccurate information, and to opt out of "sales" or "sharing" of personal information for cross-context behavioral advertising. We do not sell or share personal information for cross-context behavioral advertising.

### EEA, UK, and Swiss residents (GDPR/UK GDPR)

Where the GDPR applies, our legal bases for processing are: performance of a contract (operating your account and subscription), legitimate interests (security, fraud prevention, product improvement), consent (where required, e.g. certain optional analytics), and compliance with legal obligations. You have the right to lodge a complaint with your local supervisory authority.

---

## 9. Children

The Service is intended for users 18 and older. We do not knowingly collect personal information from anyone under 18. If we learn we have collected personal information from a user under 18, we will delete it. If you believe a minor has used BreakIQ, contact **support@getbreakiq.com**.

---

## 10. Security

We take reasonable measures to protect your information, including:

- Row-level security on every database table.
- HttpOnly, secure session cookies.
- Encryption in transit (HTTPS) and at rest (via Supabase).
- Standard security headers (CSP, X-Frame-Options, etc.).
- Authentication guards on all administrative endpoints.

No system is perfectly secure. You can help by choosing a strong password, enabling 2FA on your OAuth provider, and not sharing your invite code or account.

If we discover a breach that materially affects your information, we will notify you in accordance with applicable law.

---

## 11. International data transfers

We are based in the United States and our subprocessors operate primarily in the United States. If you access the Service from outside the U.S., you understand that your information will be transferred to and processed in the U.S. and other countries where our subprocessors operate. Where required, we rely on appropriate transfer mechanisms (such as Standard Contractual Clauses).

---

## 12. Beta status

The Service is currently in private beta. Features may change, data structures may evolve, and we may reset non-production data with notice. None of this changes the privacy commitments in this policy.

---

## 13. Changes to this policy

We may update this policy from time to time. If changes are material we will notify you by email or by an in-app notice. The "Last updated" date at the top reflects the most recent change. Your continued use of the Service after the change takes effect means you accept the updated policy.

---

## 14. Contact

For privacy questions, deletion requests, or any other inquiry under this policy:

**Mervin LLC** (d/b/a BreakIQ)
Email: **support@getbreakiq.com**
Mailing address: [TO BE PROVIDED]
