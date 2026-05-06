# BreakIQ Privacy Policy

Mervin LLC d/b/a BreakIQ

**Last updated:** May 6, 2026

**Effective date:** May 6, 2026

This Privacy Policy explains how Mervin LLC ("BreakIQ", "we", "us") collects, uses, shares, and protects information when you use BreakIQ — the sports card break pricing and analysis service available at `getbreakiq.com` (the "Service").

By using the Service you agree to this Privacy Policy and to the Terms & Conditions.

## Notice at Collection (California residents)

This is the "notice at collection" required by California Civ. Code § 1798.100. We collect the categories of personal information described in Section 3 below, including: identifiers, internet/network activity, customer-account information, sensory data (card images, transient), and inferences derived from your hobby preferences. We collect this information for the business and commercial purposes described in Section 4. We retain personal information for the periods described in Section 7. **We do not "sell" or "share" personal information for cross-context behavioral advertising** (in the meaning of California Civ. Code § 1798.140), and we do not knowingly collect personal information from minors. To exercise your CCPA / CPRA rights, see Section 8.

## 1. Who we are

The Service is operated by **Mervin LLC** (a Pennsylvania limited liability company), doing business as BreakIQ. References to "BreakIQ" in this policy refer to that entity.

If you have any questions about this policy or want to exercise a privacy right, contact us at **support@getbreakiq.com**.

Our mailing address: 718 N 2nd St, #345, Philadelphia, PA 19123.

## 2. Scope

This policy applies to information we collect through:

- The BreakIQ website and web app at `getbreakiq.com`.

- The BreakIQ-operated Discord bot and #breakiq-insights channel for allowlisted contributors.

- Email communications we send (waitlist invites, account, billing, and product notices).

- Any future BreakIQ mobile applications, browser extensions, APIs, or integrations.

This policy does **not** cover third-party platforms you may reach from BreakIQ, including Whatnot, Fanatics Live, eBay, Layton Sports Cards, Dave & Adam's, or local card shops. Sports card breaks themselves are run by third-party "breakers" on those platforms; their privacy practices are their own.

## 3. Information we collect

### 3.1 Account information

When you sign up — through email/password, Google, or Discord OAuth — we collect:

- Email address.

- Name and profile picture if provided by your OAuth provider.

- A hashed password (only if you sign up with email/password; we never see your plaintext password).

- Your OAuth provider's user identifier.

We store this in our authentication system (Supabase Auth) and a linked profile record.

### 3.2 Profile and onboarding information

After sign-up we collect, only what you choose to enter, in our 3-step onboarding wizard and on your /profile page:

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

When you upload an image of a card or slab, the image is sent to Anthropic's Claude API for parsing and to PSA's public API for verification (when a PSA cert number is detected). **We do not retain your uploaded images.** They exist only for the duration of the request and are not used to train any AI model. Anthropic's Commercial Terms prohibit Anthropic from training on customer-API inputs and outputs, and we have not opted into any data-sharing program that would change that.

Image-upload restrictions. We accept only common image formats (JPEG, PNG, WebP) and limit individual uploads to a maximum file size that we publish in the Service. We may, but are not required to, scan uploads for malware, prohibited content, embedded executable code, or visible material designed to inject instructions into our AI components (so-called "prompt injection"). We may reject, quarantine, or remove any upload at our discretion. We may also rate-limit uploads per account and per IP address to prevent abuse. Submitting uploads that violate Section 6 of the Terms (Acceptable Use) may result in account suspension or termination.

Please do not upload images that contain unrelated sensitive personal information (driver's licenses, passports, financial documents, photographs of minors, etc.). The Service is designed for sports cards.

### 3.7 Discord contributor information

If you are an allowlisted contributor in the BreakIQ Discord, when you submit /insight:

- Your Discord user ID, display name, and the raw narrative you typed are stored.

- Confirmed insights persist with full attribution (your Discord display name and the narrative you submitted) for as long as the underlying analysis is offered in the Service. We do not anonymize attribution or auto-delete confirmed insights after a fixed period.

- Confirmed insights are visible to other authenticated BreakIQ users as part of consumer-facing analysis surfaces. By submitting an insight you intend it to be shown, with attribution, to the broader BreakIQ user base.

By posting in #breakiq-insights, you agree that your submissions and your Discord display name may be visible to other authenticated BreakIQ users as part of the analysis surfaces.

Discord OAuth scopes. When you sign in with Discord, we request only the default scopes that Discord's OAuth flow uses for sign-in: **identify** (your Discord user ID, username, and avatar) and **email** (the email address associated with your Discord account, used to populate your BreakIQ account email). We do not request **guilds.members.read**, **messages.read**, DM access, your friends list, or any other Discord scope. Discord's OAuth consent screen displays the exact scopes before you approve. The BreakIQ Discord bot, which receives /insight submissions through the Discord HTTP-Interactions endpoint, operates separately from this OAuth flow and does not read messages from any Discord server outside of the official BreakIQ guild.

If you would like your Discord display name removed from confirmed insights — or want a specific confirmed insight removed — email **support@getbreakiq.com**. We will remove the attribution and/or the entry within 30 days, subject to legitimate business or fraud-prevention exceptions.

If you leave the BreakIQ Discord guild, lose contributor status, or delete your Discord account, your previously-confirmed insights remain in the Service in their published form unless you separately request removal as described above. Your Discord OAuth tokens are invalidated when you leave or revoke access through Discord, and we will no longer be able to identify you for future submissions.

### 3.8 Automatically-collected information

When you use the Service we automatically collect:

- Authentication session cookies (HttpOnly, set by Supabase Auth).

- Product analytics events via PostHog (such as user_signed_up, onboarding_completed, subscription_activated). PostHog is reverse-proxied through getbreakiq.com/ingest so your browser does not contact a third-party analytics domain directly.

- Server access logs from our hosting provider, Vercel (request paths, status codes, IP addresses, user-agent strings) — used for security, abuse prevention, and debugging.

- Crash logs, error reports, and performance telemetry — including JavaScript console errors, server-side exception traces, request latency, and similar diagnostic data — used to detect, debug, and fix problems in the Service. We make commercially reasonable efforts to scrub user-identifying information from error payloads before storage; however, error payloads may incidentally include URL parameters, form values, or other content present in the request when the error occurred.

We do not run third-party advertising cookies or sell behavioral data.

PostHog configuration and opt-out. Our PostHog instance is configured with IP anonymization enabled (we do not store full IP addresses against analytics events). We have not enabled PostHog session replay; if we enable session replay in the future, we will (a) update this Privacy Policy to disclose it, (b) configure replay to mask form input by default, and (c) provide an in-app toggle to disable it. To opt out of PostHog product analytics, set the Global Privacy Control (GPC) signal in your browser, or email **support@getbreakiq.com** requesting analytics opt-out for your account. Opting out does not affect transactional or security telemetry necessary to operate the Service.

### 3.9 California categories of personal information collected

Under the California Consumer Privacy Act / California Privacy Rights Act, we are required to disclose the categories of personal information we collect, the sources, and the categories of third parties to whom we disclose each category. The table below summarizes our practices over the prior 12 months.

|  |  |  |  |
|----|----|----|----|
| **CCPA category** | **What we collect** | **Source** | **Disclosed to** |
| A. Identifiers (name, email, IP, account ID, OAuth provider ID) | Yes — at signup, profile editing, OAuth | You; Google or Discord (if OAuth used) | Supabase, Vercel, Resend, PostHog |
| B. Customer record categories (Civ. Code §1798.80) | Limited — name, email | You | Same as above |
| C. Protected-class characteristics | No | N/A | N/A |
| D. Commercial information (subscription tier, usage counters) | Yes — when you subscribe or use a feature | You; Stripe | Stripe, Supabase, PostHog |
| E. Biometric information | No | N/A | N/A |
| F. Internet/network activity (clicks, screen views, sessions) | Yes — automatic | Your browser/app | PostHog, Vercel |
| G. Geolocation (precise) | No — only coarse IP-derived | Your network | Vercel logs |
| H. Sensory data (card images submitted to Slab Analysis) | Yes — but transient; not retained | You | Anthropic (Claude API), PSA (cert lookups) |
| I. Professional/employment info | No | N/A | N/A |
| J. Education info | No | N/A | N/A |
| K. Inferences (hobby preferences, signal interactions) | Yes — to personalize | Your interactions | Supabase, PostHog |
| L. Sensitive personal information (CPRA) | Limited — Discord login token; account credentials | You; Discord | Supabase Auth only |

"Sensitive personal information" (CPRA Civ. Code § 1798.140(ae)) is collected only for the purposes of providing the Service (authenticating your account, securing your session, and processing your payment) and is not used to infer characteristics about you. You have the right to limit our use of sensitive personal information — see Section 8.

### 3.10 Biometric information; no facial recognition

BreakIQ does not collect, capture, purchase, receive through trade, or otherwise obtain a "biometric identifier" or "biometric information" within the meaning of the Illinois Biometric Information Privacy Act (740 ILCS 14, "BIPA"), the Texas Capture or Use of Biometric Identifier Act (Tex. Bus. & Com. Code §503.001), the Washington biometric privacy law (RCW 19.375), the New York City biometric law (N.Y.C. Admin. Code §22-1201 et seq.), or analogous laws of any other jurisdiction. The Service is not designed to identify, recognize, or authenticate users using their biometric information.

In particular, in our Card Lookup tool: (a) we send the image you upload to Anthropic's Claude API for the purpose of identifying the card depicted, including the set, manufacturer, year, parallel, serial numbering, player name shown on the card, and condition signals; (b) we do not request, instruct, or use any output from Anthropic that consists of a face geometry scan, faceprint, voiceprint, fingerprint, retina scan, iris scan, hand geometry, or any other biometric identifier of any individual depicted on the card or otherwise; (c) we do not retain the uploaded image after the lookup request completes; and (d) we do not associate any image with any biometric template, biometric search index, or facial-recognition database.

If you become aware of any feature, behavior, or output of the Service that you believe constitutes the collection or use of biometric identifiers or biometric information, please notify us immediately at **privacy@getbreakiq.com** so that we can investigate.

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

- Send marketing or product-update emails — only if you have separately opted in. You can opt out anytime by clicking "unsubscribe" in any marketing email.

- Train and improve our own internal scoring models. We use aggregated behavioral data (e.g., how often a BUY signal preceded a Win-rated outcome) — not your personal identifiers — for this. We do not share inputs to or outputs of our internal models with third parties beyond what is described in Section 5.

We do not use your personal information to train third-party AI models. We do send certain transient inputs (card images, Discord narratives, card descriptors) to Anthropic's Claude API to power product features — see Section 5.

### 4.1 GDPR / UK GDPR legal bases

If you are in the European Economic Area, the United Kingdom, or Switzerland, we rely on the following legal bases under the GDPR / UK GDPR:

- Performance of a contract — to operate your account, run your subscription, and provide the analyses you have asked for.

- Legitimate interests — to secure the Service, prevent fraud and abuse, debug, and improve product quality. We have weighed these interests against your privacy interests and concluded the processing is proportionate.

- Consent — for optional marketing emails, optional analytics where required, and any future cross-border or sensitive processing where consent is the appropriate basis.

- Compliance with a legal obligation — for tax, accounting, and law-enforcement responses.

## 5. Subprocessors and data sharing

We share information with the following third-party service providers ("subprocessors") who help us operate the Service:

|  |  |  |  |  |
|----|----|----|----|----|
| **Subprocessor** | **Purpose** | **What we share** | **Region** | **DPA / privacy link** |
| Supabase, Inc. | Auth & primary database hosting | All account, profile, break-log, waitlist, and contributor data | US | supabase.com/privacy |
| Stripe, Inc. | Payment processing, subscriptions | User ID, plan, email; Stripe holds payment-instrument data | US | stripe.com/privacy |
| Anthropic, PBC | Claude API for image / narrative / card-descriptor parsing | Transient image, narrative, or descriptor only | US | anthropic.com/legal/privacy |
| CardHedger | Pricing, comp data, catalog | Card descriptors only — no user data | US | cardhedger.com/privacy |
| PSA | Cert verification, population data | Cert numbers only — no user data | US | psacard.com/privacy |
| Resend | Transactional email delivery | Recipient email and content | US | resend.com/privacy |
| PostHog | Product analytics | Pseudonymous user ID and event metadata | US | posthog.com/privacy |
| Discord, Inc. | OAuth sign-in and bot interactions | Discord user ID and /insight content | US | discord.com/privacy |
| Google LLC | OAuth sign-in only | Email, name, avatar (per scopes you approve) | US | policies.google.com/privacy |
| Vercel, Inc. | Hosting, edge logging, scheduled jobs | All request and runtime data | US | vercel.com/legal/privacy-policy |

We may also share information:

- With law enforcement or other parties if required by law, subpoena, or court order, or to protect our rights, the Service, or other users.

- In connection with a merger, acquisition, financing, or sale of assets — subject to standard confidentiality protections.

- With your consent, or at your direction.

**We do not sell your personal information.**

We also do not "share" personal information for cross-context behavioral advertising as that term is defined in California Civ. Code § 1798.140. If our practices ever change, we will provide a "Do Not Sell or Share" link before doing so.

## 6. Cookies and similar technologies

We use a small number of strictly-necessary and analytics cookies:

- A Supabase Auth session cookie to keep you signed in (HttpOnly, secure).

- A PostHog analytics cookie to attribute product events.

We do not use cross-site advertising cookies. You can disable cookies in your browser, but signing in will not work without the session cookie.

### 6.1 Global Privacy Control (GPC)

Where required by California, Colorado, Connecticut, or other applicable laws, we honor opt-out preference signals communicated through the Global Privacy Control (GPC) browser standard. Because we do not currently sell or share personal information for cross-context behavioral advertising, a GPC signal does not change our processing today; we will respect GPC signals if our practices ever change.

### 6.2 Do Not Track

Our website does not respond differently to Do Not Track (DNT) signals because there is no consensus standard for how to interpret them. We honor GPC signals as described above.

### 6.3 Tracking Technologies — disclosure and your consent

This Section provides the disclosures and obtains the consent contemplated by the California Invasion of Privacy Act (Cal. Penal Code §§630–638.55, including §631 and §638.51), the Federal Wiretap Act (18 U.S.C. §2511), and analogous state laws in Pennsylvania, Florida, Massachusetts, Maryland, Michigan, Washington, and other jurisdictions. By using the Service, you **expressly consent** to the use of the Tracking Technologies described below, and you acknowledge that this consent is informed, voluntary, and given for the purposes set forth in those statutes.

Tracking Technologies. The Service uses the following first-party and third-party technologies to collect information about your interaction with the Service:

- First-party authentication cookies set by Supabase Auth (HttpOnly, secure) for the purpose of maintaining your authenticated session.

- Product-analytics technology operated by PostHog Inc., which captures pseudonymous events relating to features you use (such as user_signed_up, onboarding_completed, lookup_performed). PostHog is configured with IP anonymization enabled, is reverse-proxied through getbreakiq.com/ingest so that your browser does not contact a third-party analytics domain directly, and (as of the date of this Policy) does not record session replay or capture form-input contents.

- Server access logs collected by our hosting provider, Vercel Inc., including request paths, response codes, IP addresses, user-agent strings, and timing — used for security, abuse prevention, and debugging.

- Crash and error-report telemetry generated by client-side JavaScript and server-side runtime, used to detect and fix bugs in the Service.

Purposes. The Tracking Technologies described above are used solely to (a) authenticate and maintain your session; (b) provide and operate features you request; (c) measure aggregate usage of the Service; (d) detect, prevent, and investigate fraud, abuse, security incidents, and unauthorized access; and (e) debug and improve the Service. We do not use Tracking Technologies for cross-context behavioral advertising, for behavioral profiling beyond product analytics, for marketing to you on third-party platforms, or for any purpose not described in this Policy.

No third-party recording. We do not authorize any third party to capture, record, intercept, eavesdrop on, replay, or analyze the contents of your communications with the Service or with our customer-service personnel beyond the technologies described above. Anthropic processes inputs you submit to the Card Lookup tool as a subprocessor under §5, not as a recording or wiretap.

Withdrawing consent and opting out. You may withdraw the consent given above at any time by (i) signing out of the Service and ceasing use; (ii) sending the Global Privacy Control (GPC) signal from your browser, which we honor for analytics opt-out; (iii) blocking or deleting cookies in your browser settings (note that authentication cookies are required to use the Service); or (iv) emailing **privacy@getbreakiq.com** to request analytics opt-out for your account. Withdrawing consent does not retroactively invalidate Tracking Technology operations that occurred before the withdrawal, but it does apply prospectively from the time we receive your request.

## 7. Data retention

- **Account and profile records** — retained while your account is active. If you request deletion, we delete or anonymize your account data within 30 days, except where we are required to retain it for legal, tax, or fraud-prevention purposes.

- **Waitlist entries** — retained until you ask us to remove them or until we determine the entry is no longer relevant (and in any event no longer than 24 months).

- **Break logs** — retained while your account is active and deleted when your account is deleted.

- **Pending Discord insights** — automatically expire 24 hours after submission if not confirmed.

- **Market observations** (asking-price and hype-tag entries) — automatically expire 14 days after observation.

- **Risk flags and sentiment history** — retained as part of the historical analysis record. Confirmed contributions remain associated with your Discord display name even after your account is deleted, unless you ask us to remove specific entries.

- **Server logs and analytics** — retained for up to 12 months for security, abuse prevention, and product analysis.

- Billing records — retained for at least 7 years to comply with U.S. federal and state tax-recordkeeping rules.

- Backups — encrypted backups are retained for up to 30 days after deletion of the underlying record.

## 8. Your rights and choices

Depending on where you live, you may have rights to:

- Access the personal information we hold about you.

- Correct inaccurate information (most fields are editable in your profile).

- Delete your account and associated personal information.

- Object to or restrict certain processing.

- Receive a portable copy of your data.

- Withdraw consent where we rely on consent.

- Opt out of automated decision-making (see Section 13).

- Limit our use of sensitive personal information (CPRA, where applicable).

- Appeal a decision we make on your privacy request, where required by law (see 8.4).

To exercise any of these rights, email us at **support@getbreakiq.com**. We will respond within 45 days. We may need to verify your identity before acting on a request. Account deletion currently runs through us — there is no in-app self-serve "delete my account" button yet, so please email us and we will handle it.

### 8.1 California residents (CCPA / CPRA)

You have the right to know what personal information we collect, to request deletion, to correct inaccurate information, and to opt out of "sales" or "sharing" of personal information for cross-context behavioral advertising. We do not sell or share personal information for cross-context behavioral advertising.

You also have the right to: (a) limit our use of sensitive personal information to what is necessary to provide the Service (we already do this); (b) opt out of automated decision-making that produces legal or similarly significant effects (none of our automated outputs do, but the right is preserved); and (c) authorize an agent to make a request on your behalf — provide written authorization signed by you.

### 8.2 Virginia, Colorado, Connecticut, Utah, Oregon, Texas, and Montana residents

If you are a resident of Virginia (VCDPA), Colorado (CPA), Connecticut (CTDPA), Utah (UCPA), Oregon (OCPA), Texas (TDPSA), or Montana (MCDPA), you have the right to: (a) confirm whether we process your personal data and to access it; (b) correct inaccuracies; (c) delete your personal data; (d) receive a portable copy; (e) opt out of "targeted advertising," "sales," and certain profiling. We do not engage in targeted advertising or sales, and we do not engage in profiling that produces legal or similarly significant effects on you. The remaining rights apply as described in Section 8.

### 8.3 EEA, UK, and Swiss residents (GDPR / UK GDPR)

Where the GDPR applies, our legal bases for processing are: performance of a contract (operating your account and subscription), legitimate interests (security, fraud prevention, product improvement), consent (where required, e.g. certain optional analytics), and compliance with legal obligations. You have the right to lodge a complaint with your local supervisory authority.

You also have the right to object to processing based on our legitimate interests; to have automated individual decision-making subjected to human review (Article 22); to have us appoint a Data Protection Officer or EU/UK representative if and when we are required to do so under Article 27 GDPR or Article 27 UK GDPR. If we are subsequently required to appoint a representative, we will publish their details here.

### 8.4 Appeals

If we deny your privacy request, you may appeal by replying to our denial within 60 days. We will review the appeal within 60 days and tell you what we decide and why. If your appeal is denied, you may have the right to escalate to the relevant state attorney general or supervisory authority — we will provide that contact information at the time we deny the appeal.

## 9. Children

The Service is intended for users 18 and older. We do not knowingly collect personal information from anyone under 18. If we learn we have collected personal information from a user under 18, we will delete it. If you believe a minor has used BreakIQ, contact **support@getbreakiq.com**.

Because the Service is 18+ only, we do not target children, do not display content directed to children, and have not designed any features to appeal specifically to children. We do not collect personal information from children under 13 within the meaning of the Children's Online Privacy Protection Act (COPPA, 15 U.S.C. § 6501 et seq.). If a parent or legal guardian believes their child has provided personal information to us, please email **support@getbreakiq.com** and we will delete the information and close any associated account within 14 days.

## 10. Security

We take reasonable measures to protect your information, including:

- Row-level security on every database table.

- HttpOnly, secure session cookies.

- Encryption in transit (HTTPS) and at rest (via Supabase).

- Standard security headers (CSP, X-Frame-Options, etc.).

- Authentication guards on all administrative endpoints.

- Restricted-access secrets management; principle of least privilege for employee and contractor access.

- Periodic vulnerability and dependency scanning.

### 10.1 Authentication and account security

Supported authentication methods. You can sign into the Service using (a) email and password (passwords are hashed using Supabase Auth's password hashing; we never store or transmit your plaintext password) or (b) OAuth through Google or Discord. We do not currently issue social-login tokens to additional providers.

Two-factor authentication. Multi-factor authentication for the BreakIQ Service is provided through your OAuth provider — that is, if you enable 2FA on your Google or Discord account, that 2FA challenge applies when you sign into BreakIQ via OAuth. We do not currently offer a separate BreakIQ-native 2FA mechanism for email/password accounts; we may add one in the future and will update this Policy when we do.

Sessions and idle timeout. Your authenticated session is maintained by an HttpOnly session cookie issued by Supabase Auth. Sessions expire on a rolling basis according to the configuration we maintain in Supabase Auth, and you will be required to sign in again after the session expires or after sign-out. We may shorten or extend session lifetimes for security reasons without prior notice.

Suspicious activity. We monitor for indicators of credential stuffing, brute-force attempts, and unusual access patterns. If we detect activity suggesting your credentials may have been compromised — for example, anomalous geographic access, repeated failed login attempts, or sign-ins from known-compromised IP ranges — we may, in our discretion, lock the affected account, force a password reset, invalidate active sessions, or require additional verification before restoring access. We will use reasonable efforts to notify you when we take such action.

Your responsibilities. You are responsible for choosing a strong, unique password, for enabling 2FA on your OAuth provider, for keeping your devices and email account secure, and for promptly notifying us at **support@getbreakiq.com** if you suspect any unauthorized access to your account.

### 10.2 Backups and deletion residue

When you request deletion of your account or specific personal information, we delete or anonymize the data in our active production systems within 30 days. We do not restore individual records from backup other than in connection with a documented incident-recovery process. Access to backup systems is restricted to a small number of authorized personnel under audit logging.

Beta-period backup posture. As of the Effective Date, BreakIQ is in private beta and operates on the free tier of our database provider (Supabase), which does not include scheduled automated database backups. During this period, our backup posture is best-effort and we do not commit to a specific backup retention window. We will upgrade to a paid Supabase tier providing daily automated backups with seven (7) day retention on or before public launch, after which deleted data may persist in those backups until the backup cycles out (in any event no longer than seven (7) days from the date the backup was taken). Backups are encrypted in transit and at rest by Supabase under Supabase's terms.

No system is perfectly secure. You can help by choosing a strong password, enabling 2FA on your OAuth provider, and not sharing your invite code or account.

If we discover a breach that materially affects your information, we will notify you in accordance with applicable law, and where the law does not specify, within 72 hours of confirming the scope and impact of the breach. Notification will describe what happened, what categories of information were affected, what we are doing about it, and what steps you can take.

## 11. International data transfers

We are based in the United States and our subprocessors operate primarily in the United States. If you access the Service from outside the U.S., you understand that your information will be transferred to and processed in the U.S. and other countries where our subprocessors operate. Where required, we rely on appropriate transfer mechanisms (such as Standard Contractual Clauses), the UK International Data Transfer Addendum, the EU-US Data Privacy Framework where the recipient is certified, and equivalent mechanisms.

## 12. Beta status

The Service is currently in private beta. Features may change, data structures may evolve, and we may reset non-production data with notice. None of this changes the privacy commitments in this policy.

## 13. Automated decision-making and AI processing

BreakIQ uses automated systems, including third-party large-language-model providers (Anthropic via the Claude API), to generate analyses, signals, and lookups. We disclose this processing in detail because some privacy laws (CPRA, GDPR Article 22, the EU AI Act, the Colorado AI Act) require it.

### 13.1 What we automate

\(a\) BUY / WATCH / PASS signals and EV scores derived from break inputs and historical comp data; (b) BreakIQ Sayz analyses generated from card and break descriptors; (c) Card Lookup — parsing of a card image to extract player, year, set, and condition cues; (d) sentiment / hype / risk indicators derived from confirmed Discord insights; (e) personalization of the home feed based on your stated hobby preferences.

### 13.2 No "significant" automated decisions about you

None of these automated outputs make a decision that produces a legal effect on you or that significantly affects you in the meaning of GDPR Article 22 or CPRA Civ. Code § 1798.185(a)(16). They are informational outputs about cards and breaks, not about you.

### 13.3 Right to human review

You can request a human review of any AI output by emailing **support@getbreakiq.com**. We will respond within a reasonable time and may correct, override, or annotate the output at our discretion.

### 13.4 No model training on your inputs

We do not use your card images, Discord narratives, account data, or break logs to train Anthropic's foundation models. Anthropic's Commercial Terms prohibit such training on customer-API inputs and outputs by default, and we have not opted into any data-sharing program. We may use aggregated, de-identified behavioral data (e.g., hit-rate of BUY signals) to improve our internal scoring models — never your identifiers.

## 14. Data breach notification

In the event of a security incident affecting personal information:

- We will promptly investigate and contain the incident.

- We will assess the scope and impact and identify affected users.

- We will notify affected users within 72 hours of confirming impact (or sooner if required by law) — typically by email to the address on file. Notice will include: a description of what happened; the types of information affected; the steps we are taking; and steps you can take to protect yourself.

- We will notify regulators and supervisory authorities as required by applicable U.S. state breach-notification statutes, GDPR Article 33, and other applicable laws.

- We will preserve evidence and cooperate with law-enforcement and regulator investigations.

## 15. Changes to this policy

We may update this policy from time to time. If changes are material we will notify you by email or by an in-app notice. The "Last updated" date at the top reflects the most recent change. Your continued use of the Service after the change takes effect means you accept the updated policy.

If a change materially expands the scope of personal-information collection or use, we will provide affirmative consent before doing so where required by law.

## 16. Contact

For privacy questions, deletion requests, or any other inquiry under this policy:

**Mervin LLC** (d/b/a BreakIQ)

**Email:** support@getbreakiq.com / privacy: **privacy@getbreakiq.com**

**Mailing address:** 718 N 2nd St, #345, Philadelphia, PA 19123

Data Protection Officer / EU representative: