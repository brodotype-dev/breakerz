import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { TERMS_PATH, PRIVACY_PATH } from '@/lib/legal';
import BackButton from './BackButton';

/**
 * Public layout for /privacy and /terms. Routes are publicly accessible —
 * not in middleware.ts's matcher — so unauthenticated visitors can read
 * them straight from the waitlist page or a marketing email.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--terminal-bg)' }}>
      <header
        className="border-b sticky top-0 z-20"
        style={{
          borderColor: 'var(--terminal-border)',
          backgroundColor: 'rgba(19, 24, 32, 0.97)',
          backdropFilter: 'blur(8px)',
          paddingTop: 'env(safe-area-inset-top)',
        }}
      >
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <BackButton />
            <Link href="/" className="flex items-center shrink-0" aria-label="BreakIQ home">
              <Logo variant="lockup" height={28} className="h-7 w-auto" />
            </Link>
          </div>
          <nav className="flex items-center gap-4 sm:gap-5 text-xs shrink-0">
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
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <article className="legal-prose">{children}</article>
      </main>
      <style>{`
        .legal-prose {
          color: var(--text-secondary);
          font-size: 15px;
          line-height: 1.65;
        }
        .legal-prose h1 {
          font-size: clamp(22px, 6vw, 28px);
          font-weight: 800;
          color: var(--text-primary);
          margin-top: 0;
          margin-bottom: 8px;
          line-height: 1.2;
          word-wrap: break-word;
        }
        .legal-prose h2 {
          font-size: clamp(17px, 4.5vw, 20px);
          font-weight: 700;
          color: var(--text-primary);
          margin-top: 32px;
          margin-bottom: 12px;
          line-height: 1.3;
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
