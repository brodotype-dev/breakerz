import { Resend } from 'resend';

// Senders. All must be on a verified Resend domain.
//   FROM_INVITES — env-backed; FROM_EMAIL must be set to a verified address.
//                  No silent fallback to an unverified domain — that was the
//                  shape of the 2026-04→2026-05 silent-failure bug.
//   FROM_HELLO   — hardcoded to the verified getbreakiq.com domain. Used for
//                  marketing-toned consumer touches (waitlist confirmation,
//                  welcome). Kept separate from invites so we can re-brand
//                  one without touching the other.
const FROM_HELLO = 'hello@getbreakiq.com';

function getResend() {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('Missing RESEND_API_KEY env var');
  }
  return new Resend(process.env.RESEND_API_KEY);
}

function fromInvites(): string {
  const v = process.env.FROM_EMAIL;
  if (!v) {
    throw new Error('Missing FROM_EMAIL env var (expected an address on a verified Resend domain)');
  }
  return v;
}

// The Resend Node SDK returns { data, error } and DOES NOT throw on API
// rejections (invalid key, unverified domain, bad recipient). Awaiting
// `emails.send` and ignoring `error` is exactly how the 2026-04→2026-05
// silent invite failures happened. Always route through this so a Resend-
// side rejection becomes a thrown error our callers can catch + observe.
type ResendResult = { data: { id: string } | null; error: { name?: string; message?: string } | null };
function unwrap(result: ResendResult, label: string): { id: string } {
  if (result.error) {
    const detail = result.error.message ?? result.error.name ?? JSON.stringify(result.error);
    throw new Error(`${label}: Resend rejected the send — ${detail}`);
  }
  if (!result.data) {
    throw new Error(`${label}: Resend returned neither data nor error`);
  }
  return result.data;
}

const escapeHtml = (s: string) =>
  s.replace(/[<>"'&]/g, c => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;' }[c] ?? c));

function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.getbreakiq.com';
}

// Shared email-body shell. Dark theme, 600px content table, brand wordmark
// at the top. Centralized so subject/CTA are the only per-email decisions.
//
// Why nested tables and not <div>s: email clients (Outlook in particular) are
// inconsistent about CSS background propagation on <div>s. The outer table
// gets a full-bleed dark background so Gmail/desktop renders the email as a
// dark email, not a dark card floating on Gmail's white container.
function emailShell({
  bodyHtml,
  preheader,
}: { bodyHtml: string; preheader?: string }): string {
  const base = appBaseUrl();
  const safePre = preheader ? escapeHtml(preheader) : '';
  return `
    ${preheader ? `<div style="display:none;max-height:0;overflow:hidden">${safePre}</div>` : ''}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #0a0e1a;">
      <tr>
        <td align="center" style="padding: 40px 16px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%;">
            <tr>
              <td style="font-family: -apple-system, sans-serif; color: #e2e8f0; background: #0a0e1a; padding: 40px 32px;">
                <img src="${base}/brand/wordmark-email.png" alt="BreakIQ" width="120" height="30" style="display: block; margin: 0 0 24px; height: 30px; width: auto;" />
                ${bodyHtml}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

// ──────────────────────────────────────────────────────────────────────────
// Approval invite — fired from /api/admin/waitlist/[id]/approve
// ──────────────────────────────────────────────────────────────────────────
export async function sendInviteEmail({
  to,
  fullName,
  inviteCode,
}: {
  to: string;
  fullName: string | null;
  inviteCode: string;
}) {
  const base = appBaseUrl();
  const inviteUrl = `${base}/auth/signup?code=${encodeURIComponent(inviteCode)}`;
  const firstName = escapeHtml(fullName?.split(' ')[0] ?? 'there');
  const safeTo = escapeHtml(to);

  const result = await getResend().emails.send({
    from: fromInvites(),
    to,
    subject: "You're in — BreakIQ Beta",
    html: emailShell({
      preheader: 'Your beta access is ready — create your account.',
      bodyHtml: `
        <h1 style="font-size: 24px; font-weight: 700; margin: 0 0 12px; color: #f1f5f9;">Hey ${firstName}, you're in.</h1>
        <p style="font-size: 15px; line-height: 1.6; color: #94a3b8; margin: 0 0 32px;">
          Your beta access is ready. Use the button below to create your account — your invite code is pre-filled.
        </p>
        <a href="${inviteUrl}" style="display: inline-block; background: #3b82f6; color: #fff; font-weight: 700; font-size: 14px; padding: 12px 24px; border-radius: 8px; text-decoration: none;">
          Create my account →
        </a>
        <p style="font-size: 12px; color: #475569; margin: 32px 0 0;">
          Or copy this link: ${inviteUrl}
        </p>
        <hr style="border: none; border-top: 1px solid #1e293b; margin: 32px 0;" />
        <p style="font-size: 11px; color: #334155; margin: 0;">
          This invite is for ${safeTo} only. If you didn't request access, ignore this email.
        </p>
      `,
    }),
  });
  unwrap(result as ResendResult, 'sendInviteEmail');
}

// ──────────────────────────────────────────────────────────────────────────
// Waitlist join confirmation — fired from /api/waitlist on successful insert
// ──────────────────────────────────────────────────────────────────────────
export async function sendWaitlistConfirmation({
  to,
  fullName,
}: {
  to: string;
  fullName: string | null;
}) {
  const firstName = escapeHtml(fullName?.split(' ')[0] ?? 'there');

  const result = await getResend().emails.send({
    from: FROM_HELLO,
    to,
    subject: "You're on the BreakIQ list.",
    html: emailShell({
      preheader: "We'll email you when your access opens up.",
      bodyHtml: `
        <h1 style="font-size: 24px; font-weight: 700; margin: 0 0 12px; color: #f1f5f9;">Hey ${firstName}, you're on the list.</h1>
        <p style="font-size: 15px; line-height: 1.6; color: #94a3b8; margin: 0 0 16px;">
          Thanks for joining the BreakIQ waitlist. We're letting people in as we widen access — you'll get an email from us with a signup link the moment your seat is ready.
        </p>
        <p style="font-size: 15px; line-height: 1.6; color: #94a3b8; margin: 0 0 32px;">
          In the meantime, hit reply if you've got questions, breaks you'd like us to cover, or feedback. We read everything.
        </p>
        <p style="font-size: 13px; color: #64748b; margin: 0;">— The BreakIQ Team</p>
      `,
    }),
  });
  unwrap(result as ResendResult, 'sendWaitlistConfirmation');
}

// ──────────────────────────────────────────────────────────────────────────
// Post-signup welcome — fired from /auth/callback on first profile creation
// ──────────────────────────────────────────────────────────────────────────
export async function sendWelcomeEmail({
  to,
  firstName: firstNameInput,
}: {
  to: string;
  firstName: string | null;
}) {
  const base = appBaseUrl();
  const firstName = escapeHtml(firstNameInput ?? 'there');

  const result = await getResend().emails.send({
    from: FROM_HELLO,
    to,
    subject: 'Welcome to BreakIQ — what to try first.',
    html: emailShell({
      preheader: 'Two quick links to get the most out of your beta.',
      bodyHtml: `
        <h1 style="font-size: 24px; font-weight: 700; margin: 0 0 12px; color: #f1f5f9;">Welcome in, ${firstName}.</h1>
        <p style="font-size: 15px; line-height: 1.6; color: #94a3b8; margin: 0 0 24px;">
          BreakIQ exists for one thing: stop you overpaying breakers. Two places to start:
        </p>

        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%; margin: 0 0 24px;">
          <tr>
            <td style="padding: 12px 0; border-top: 1px solid #1e293b;">
              <a href="${base}/" style="font-size: 15px; font-weight: 700; color: #3b82f6; text-decoration: none;">Browse upcoming breaks →</a>
              <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 4px 0 0;">
                Every active product, with our model's verdict on each.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 12px 0; border-top: 1px solid #1e293b; border-bottom: 1px solid #1e293b;">
              <a href="${base}/chase" style="font-size: 15px; font-weight: 700; color: #3b82f6; text-decoration: none;">Save players to your Chase →</a>
              <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 4px 0 0;">
                Tap any heart icon next to a player name to track them across products.
              </p>
            </td>
          </tr>
        </table>

        <p style="font-size: 15px; line-height: 1.6; color: #94a3b8; margin: 0 0 24px;">
          You're in private beta — reply to this email anytime with bugs, ideas, or screenshots of pricing that feels wrong. Direct feedback shapes what ships next.
        </p>
        <p style="font-size: 13px; color: #64748b; margin: 0;">— The BreakIQ Team</p>
      `,
    }),
  });
  unwrap(result as ResendResult, 'sendWelcomeEmail');
}
