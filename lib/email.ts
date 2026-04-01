import { Resend } from 'resend';

// Initialize lazily so missing env var doesn't crash the build
function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

const FROM = process.env.FROM_EMAIL ?? 'invites@breakerz.vercel.app';

export async function sendInviteEmail({
  to,
  fullName,
  inviteCode,
}: {
  to: string;
  fullName: string | null;
  inviteCode: string;
}) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://breakerz.vercel.app';
  const inviteUrl = `${baseUrl}/auth/signup?code=${inviteCode}`;
  const firstName = fullName?.split(' ')[0] ?? 'there';

  await getResend().emails.send({
    from: FROM,
    to,
    subject: "You're in — Breakerz Beta",
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; color: #e2e8f0; background: #0a0e1a; padding: 40px 32px; border-radius: 12px;">
        <p style="font-size: 11px; font-weight: 800; letter-spacing: 0.15em; text-transform: uppercase; color: #3b82f6; margin: 0 0 24px;">Card Breakerz</p>
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
          This invite is for ${to} only. If you didn't request access, ignore this email.
        </p>
      </div>
    `,
  });
}
