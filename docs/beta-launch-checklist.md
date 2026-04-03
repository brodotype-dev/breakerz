# BreakIQ — Beta Launch Checklist

Work through these in order. Each section is a logical group — don't move to the next until the current one is solid.

---

## 1. Domain & Email

- [x] **name.com — email forwarding**
  - Create forward: `hello@getbreakiq.com` → your personal email
  - Create forward: `invites@getbreakiq.com` → your personal email

- [x] **Resend — verify getbreakiq.com domain**
  - Resend dashboard → Domains → Add Domain → `getbreakiq.com`
  - Add the DNS records Resend provides (MX, TXT, DKIM) in name.com DNS
  - Wait for verification (usually a few minutes)

- [x] **Vercel — update FROM_EMAIL**
  - Change `FROM_EMAIL` from `invites@breakerz.vercel.app` → `invites@getbreakiq.com`
  - Apply to Production, Preview, and Development environments

---

## 2. Custom Domain on Vercel

- [x] **Vercel — add custom domain**
  - Project Settings → Domains → Add `getbreakiq.com` and `www.getbreakiq.com`
  - Vercel will give you DNS records to add (A record or CNAME)

- [x] **name.com — point DNS to Vercel**
  - Add the A record / CNAME Vercel provides
  - DNS propagation can take up to 24h but usually minutes

- [x] **Vercel — update NEXT_PUBLIC_APP_URL**
  - Change from `https://breakerz.vercel.app` → `https://getbreakiq.com` in Production environment

- [x] **Supabase — update redirect URLs (both projects)**
  - Production project: Auth → URL Configuration → Site URL → `https://getbreakiq.com`
  - Add `https://getbreakiq.com/auth/callback` to Redirect URLs
  - Staging project: keep as-is (`http://localhost:3000` / staging URL)

---

## 3. Google OAuth

- [x] **Google Cloud Console — OAuth consent screen**
  - APIs & Services → OAuth consent screen
  - User type: External
  - App name: `BreakIQ`, support email, developer email
  - Scopes: email, profile, openid (defaults)
  - Add your own email as a test user for now

- [x] **Google Cloud Console — create OAuth credentials**
  - APIs & Services → Credentials → Create → OAuth 2.0 Client ID
  - Application type: Web application
  - Authorized redirect URIs:
    - `https://zucuzhtiitibsvryenpi.supabase.co/auth/v1/callback` (production)
    - `https://isqxqsznbozlipjvttha.supabase.co/auth/v1/callback` (staging)
  - Save the Client ID and Client Secret

- [x] **Supabase — enable Google provider (both projects)**
  - Auth → Providers → Google → enable, paste Client ID + Secret → Save
  - Do this for both production and staging Supabase projects

---

## 4. Supabase Cleanup

- [x] **Staging — create admin user**
  - Staging Supabase dashboard → Auth → Users → Add user
  - SQL editor: insert into `profiles` + `user_roles` (role: 'admin')

- [x] **Production — verify migration repair was applied**
  - Confirm `20260101000000_initial_schema.sql` is marked as applied
  - Run: `supabase link --project-ref zucuzhtiitibsvryenpi && supabase migration list`

---

## 5. Vercel Cleanup

- [x] **Remove dead env vars from Production**
  - Delete `ADMIN_PASSWORD`
  - Delete `ADMIN_SESSION_SECRET`

---

## 6. Deploy & Smoke Test

- [x] **Push and deploy** *(completed 2026-04-03)*

- [ ] **Test waitlist flow (incognito)**
  - Go to `getbreakiq.com/waitlist` → submit → confirm success state
  - Go to `getbreakiq.com/break/...` → confirm redirect to waitlist

- [ ] **Test admin flow**
  - Log in at `getbreakiq.com/admin/login`
  - Find the waitlist entry → Approve + Invite
  - Confirm email arrives from `invites@getbreakiq.com`
  - Confirm invite link works and lands on `/auth/signup?code=...`

- [ ] **Test Google OAuth (staging first)**
  - Use staging URL with a test invite code
  - Click "Continue with Google" → complete OAuth → confirm redirect to home
  - Confirm `profiles` row created in staging Supabase
  - Confirm waitlist entry marked as `converted`

- [ ] **Test Google OAuth on production**
  - Same flow on `getbreakiq.com`

---

## 7. Before Inviting Real Users

- [ ] **Google OAuth consent screen — publish the app**
  - While in "Testing" mode, only listed test users can sign in
  - Google Cloud → OAuth consent screen → Publish App (or add beta users as test users)
  - Publishing triggers a verification review for some scopes — email/profile/openid are usually instant

- [ ] **Send yourself a real invite** — full end-to-end from admin approval → email → signup → access

- [ ] **Confirm `/break/*` and `/analysis/*` are gated** — test in incognito on production

---

## Optional (nice to have before wider beta)

- [ ] Apple OAuth — requires Apple Developer account ($99/yr), more setup than Google
- [ ] `www` redirect — confirm `www.getbreakiq.com` redirects to `getbreakiq.com` (Vercel handles this automatically when both are added)
- [ ] Privacy policy / terms page — required by Google before publishing OAuth app to public
- [ ] Error monitoring — Sentry or Vercel's built-in error tracking
