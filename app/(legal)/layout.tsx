import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { TERMS_PATH, PRIVACY_PATH } from '@/lib/legal';

/**
 * Public layout for /privacy and /terms. Routes are publicly accessible —
 * not in middleware.ts's matcher — so unauthenticated visitors can read
 * them straight from the waitlist page or a marketing email.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--terminal-bg)' }}>
      <header
        className="border-b"
        style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
      >
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center">
            <Logo variant="lockup" height={28} width={140} className="h-7 w-auto" />
          </Link>
          <nav className="flex items-center gap-5 text-xs">
            <Link
              href={PRIVACY_PATH}
              className="hover:underline"
              style={{ color: 'var(--text-secondary)' }}
            >
              Privacy
            </Link>
            <Link
              href={TERMS_PATH}
              className="hover:underline"
              style={{ color: 'var(--text-secondary)' }}
            >
              Terms
            </Link>
          </nav>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-10">
        <article className="legal-prose">{children}</article>
      </main>
      <style>{`
        .legal-prose {
          color: var(--text-secondary);
          font-size: 15px;
          line-height: 1.65;
        }
        .legal-prose h1 {
          font-size: 28px;
          font-weight: 800;
          color: var(--text-primary);
          margin-top: 0;
          margin-bottom: 8px;
        }
        .legal-prose h2 {
          font-size: 20px;
          font-weight: 700;
          color: var(--text-primary);
          margin-top: 36px;
          margin-bottom: 12px;
        }
        .legal-prose h3 {
          font-size: 16px;
          font-weight: 700;
          color: var(--text-primary);
          margin-top: 24px;
          margin-bottom: 8px;
        }
        .legal-prose p {
          margin: 0 0 14px;
        }
        .legal-prose ul, .legal-prose ol {
          margin: 0 0 14px;
          padding-left: 22px;
        }
        .legal-prose li {
          margin: 4px 0;
        }
        .legal-prose strong {
          color: var(--text-primary);
        }
        .legal-prose a {
          color: var(--accent-blue);
          text-decoration: underline;
        }
        .legal-prose hr {
          margin: 28px 0;
          border: 0;
          border-top: 1px solid var(--terminal-border);
        }
        .legal-prose blockquote {
          margin: 0 0 14px;
          padding: 12px 16px;
          border-left: 3px solid var(--accent-blue);
          background-color: var(--terminal-surface);
          color: var(--text-secondary);
          font-size: 14px;
          border-radius: 0 8px 8px 0;
        }
        .legal-prose blockquote p:last-child {
          margin: 0;
        }
        .legal-prose table {
          width: 100%;
          border-collapse: collapse;
          margin: 14px 0;
          font-size: 14px;
        }
        .legal-prose th, .legal-prose td {
          padding: 8px 12px;
          border: 1px solid var(--terminal-border);
          text-align: left;
          vertical-align: top;
        }
        .legal-prose th {
          background-color: var(--terminal-surface);
          color: var(--text-primary);
          font-weight: 600;
        }
        .legal-prose code {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 13px;
          padding: 1px 5px;
          border-radius: 4px;
          background-color: var(--terminal-surface);
          color: var(--text-primary);
        }
      `}</style>
    </div>
  );
}
