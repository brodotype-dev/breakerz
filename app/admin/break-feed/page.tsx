import { supabaseAdmin } from '@/lib/supabase';
import { productPhrase } from '@/lib/break-feed-match';
import { AlertTriangle, CheckCircle2, Radio, Store, ExternalLink } from 'lucide-react';
import RefreshBreakFeedButton from './RefreshBreakFeedButton';

// Break feed — what the market is actually breaking, and what of it we can
// price.
//
// The headline is deliberately the GAP, not the coverage. A row we match is
// confirmation; a row we cannot match is the actionable thing: the market is
// selling a product we have no catalog for, which means we could not value
// that spot if a user asked us to.
//
// Two fidelities, labelled as such (verified 2026-11-22):
//   - Shop storefronts pre-list breaks as products → spot price, spots, date.
//   - Live platforms publish no break list before a show starts → title and
//     time only. Not a scraping gap; the inventory does not exist yet.
//
// Pure server component, cache-only read. The Refresh button and the nightly
// cron are what populate it.

export const dynamic = 'force-dynamic';

interface BreakRow {
  id: string;
  kind: 'steel_city' | 'fanatics_live';
  title: string;
  url: string | null;
  sport: string | null;
  break_date_label: string | null;
  price: number | null;
  spots_available: number | null;
  breaker: string | null;
  configuration: string | null;
  matched_product_id: string | null;
  match_reason: string | null;
  last_seen_at: string;
  products: { name: string; slug: string } | null;
}

interface SourceRow {
  id: string;
  kind: string;
  identifier: string;
  label: string | null;
  is_active: boolean;
  last_scraped_at: string | null;
  last_error: string | null;
}

export default async function BreakFeedPage() {
  const [{ data: sources }, { data: breaks }] = await Promise.all([
    supabaseAdmin
      .from('break_feed_sources')
      .select('id, kind, identifier, label, is_active, last_scraped_at, last_error')
      .order('kind'),
    supabaseAdmin
      .from('upcoming_breaks')
      .select(
        'id, kind, title, url, sport, break_date_label, price, spots_available, breaker, ' +
          'configuration, matched_product_id, match_reason, last_seen_at, products(name, slug)'
      )
      .is('disappeared_at', null)
      .order('last_seen_at', { ascending: false })
      .limit(500),
  ]);

  const rows = (breaks ?? []) as unknown as BreakRow[];
  const sourceRows = (sources ?? []) as SourceRow[];

  // Non-sports (Pokemon, Marvel, Star Wars, Disney, One Piece…) is a real and
  // sizeable slice of every breaker's board, but it is not a market we price.
  // Counted, then set aside.
  const sports = rows.filter(r => r.sport !== 'non_sports');
  const nonSports = rows.filter(r => r.sport === 'non_sports');

  const covered = sports.filter(r => r.matched_product_id);
  const gaps = sports.filter(r => !r.matched_product_id);

  // Rank the gap by how many breaks are selling it. One listing is noise;
  // three breakers running the same product this week is a roster decision.
  const gapGroups = new Map<
    string,
    { phrase: string; count: number; reason: string; sport: string | null; examples: BreakRow[] }
  >();
  for (const row of gaps) {
    const phrase = productPhrase(row.title);
    if (!phrase) continue;
    const key = phrase.toLowerCase();
    const existing = gapGroups.get(key);
    if (existing) {
      existing.count++;
      if (existing.examples.length < 3) existing.examples.push(row);
    } else {
      gapGroups.set(key, {
        phrase,
        count: 1,
        reason: row.match_reason ?? '',
        sport: row.sport,
        examples: [row],
      });
    }
  }
  const rankedGaps = [...gapGroups.values()].sort(
    (a, b) => b.count - a.count || a.phrase.localeCompare(b.phrase)
  );

  const coveragePct = sports.length > 0 ? Math.round((covered.length / sports.length) * 100) : 0;

  return (
    <div className="p-8 space-y-8 max-w-[1200px]">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
          Break Feed
        </h1>
        <p className="text-sm max-w-3xl" style={{ color: 'var(--text-secondary)' }}>
          What the market is breaking right now, and how much of it we can price. Rows we
          can&rsquo;t match are the signal — each one is a product being sold that we have no
          catalog for.
        </p>
        <RefreshBreakFeedButton />
      </header>

      {/* ---- headline counts ------------------------------------------- */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Sports breaks tracked" value={String(sports.length)} />
        <Stat
          label="We can price"
          value={`${covered.length}`}
          sub={`${coveragePct}% of sports breaks`}
          tone={coveragePct >= 50 ? 'good' : coveragePct >= 20 ? 'warn' : 'bad'}
        />
        <Stat
          label="Coverage gaps"
          value={String(rankedGaps.length)}
          sub="distinct products we don't carry"
          tone={rankedGaps.length === 0 ? 'good' : 'warn'}
        />
        <Stat label="Non-sports (ignored)" value={String(nonSports.length)} />
      </section>

      {/* ---- sources ---------------------------------------------------- */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Sources
        </h2>
        <div className="grid gap-2 md:grid-cols-2">
          {sourceRows.length === 0 && (
            <EmptyNote>No sources configured yet.</EmptyNote>
          )}
          {sourceRows.map(s => (
            <div
              key={s.id}
              className="rounded-xl p-4 text-xs space-y-1"
              style={{
                border: '1px solid var(--terminal-border)',
                backgroundColor: 'var(--terminal-surface)',
              }}
            >
              <div className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                {s.kind === 'steel_city' ? (
                  <Store className="w-3.5 h-3.5" />
                ) : (
                  <Radio className="w-3.5 h-3.5" />
                )}
                <span className="font-medium">{s.label ?? s.identifier}</span>
                {!s.is_active && <span style={{ color: 'var(--text-tertiary)' }}>· paused</span>}
              </div>
              <div style={{ color: 'var(--text-tertiary)' }}>
                {s.kind === 'steel_city'
                  ? 'Pre-listed breaks — carries spot price, spots left, date'
                  : 'Shows only — this platform publishes no break list before a show starts'}
              </div>
              <div style={{ color: 'var(--text-tertiary)' }}>
                {s.last_scraped_at
                  ? `Last pulled ${new Date(s.last_scraped_at).toLocaleString()}`
                  : 'Never pulled'}
              </div>
              {s.last_error && (
                <div className="flex items-start gap-1.5" style={{ color: 'var(--danger, #b4433a)' }}>
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                  <span>{s.last_error}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ---- the gap ---------------------------------------------------- */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Coverage gaps — what&rsquo;s breaking that we can&rsquo;t price
        </h2>
        {rankedGaps.length === 0 ? (
          <EmptyNote>
            Nothing unmatched. Either the feed is empty or our catalog covers every sports break
            on the board.
          </EmptyNote>
        ) : (
          <TableShell
            head={['Product being broken', 'Breaks', 'Sport', 'Why we miss it']}
            widths={['w-[38%]', 'w-[8%]', 'w-[12%]', 'w-[42%]']}
          >
            {rankedGaps.map(g => (
              <tr
                key={g.phrase}
                className="hover:bg-[var(--terminal-surface-hover)] transition-colors"
                style={{ color: 'var(--text-secondary)' }}
              >
                <td className="px-4 py-2.5">
                  <div style={{ color: 'var(--text-primary)' }}>{g.phrase}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                    {g.examples[0]?.title.slice(0, 72)}
                    {(g.examples[0]?.title.length ?? 0) > 72 ? '…' : ''}
                  </div>
                </td>
                <td className="px-4 py-2.5 tabular-nums">{g.count}</td>
                <td className="px-4 py-2.5">{g.sport ?? '—'}</td>
                <td className="px-4 py-2.5 text-[11px]">{g.reason}</td>
              </tr>
            ))}
          </TableShell>
        )}
      </section>

      {/* ---- what we cover ---------------------------------------------- */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Breaks we can price
        </h2>
        {covered.length === 0 ? (
          <EmptyNote>
            No breaks on the board match a product we carry right now.
          </EmptyNote>
        ) : (
          <TableShell
            head={['Break', 'Our product', 'Ask', 'Spots', 'When', 'Breaker']}
            widths={['w-[34%]', 'w-[20%]', 'w-[10%]', 'w-[8%]', 'w-[14%]', 'w-[14%]']}
          >
            {covered.map(row => (
              <tr
                key={row.id}
                className="hover:bg-[var(--terminal-surface-hover)] transition-colors"
                style={{ color: 'var(--text-secondary)' }}
              >
                <td className="px-4 py-2.5">
                  {row.url ? (
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-start gap-1 hover:underline"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      <span>{row.title.slice(0, 64)}</span>
                      <ExternalLink className="w-3 h-3 shrink-0 mt-0.5" />
                    </a>
                  ) : (
                    <span style={{ color: 'var(--text-primary)' }}>{row.title.slice(0, 64)}</span>
                  )}
                  {row.configuration && (
                    <span className="ml-2 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                      {row.configuration}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" style={{ color: 'var(--buy, #1a8043)' }} />
                    {row.products?.name ?? '—'}
                  </span>
                </td>
                <td className="px-4 py-2.5 tabular-nums">
                  {row.price !== null ? (
                    `$${Number(row.price).toFixed(2)}`
                  ) : (
                    <span title="This platform publishes no price before the show starts">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 tabular-nums">
                  {row.spots_available ?? '—'}
                </td>
                <td className="px-4 py-2.5">{row.break_date_label ?? '—'}</td>
                <td className="px-4 py-2.5">{row.breaker ?? '—'}</td>
              </tr>
            ))}
          </TableShell>
        )}
      </section>

      <FootNote />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'good' | 'warn' | 'bad';
}) {
  const color =
    tone === 'good'
      ? 'var(--buy, #1a8043)'
      : tone === 'bad'
        ? 'var(--danger, #b4433a)'
        : tone === 'warn'
          ? 'var(--warn, #9a6b1f)'
          : 'var(--text-primary)';

  return (
    <div
      className="rounded-xl p-4"
      style={{
        border: '1px solid var(--terminal-border)',
        backgroundColor: 'var(--terminal-surface)',
      }}
    >
      <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums mt-1" style={{ color }}>
        {value}
      </div>
      {sub && (
        <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function TableShell({
  head,
  widths,
  children,
}: {
  head: string[];
  widths: string[];
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        border: '1px solid var(--terminal-border)',
        backgroundColor: 'var(--terminal-surface)',
      }}
    >
      <table className="w-full text-xs">
        <thead>
          <tr style={{ backgroundColor: 'var(--terminal-surface-hover)' }}>
            {head.map((h, i) => (
              <th
                key={h}
                className={`px-4 py-2.5 text-left font-medium ${widths[i] ?? ''}`}
                style={{ color: 'var(--text-tertiary)' }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl p-6 text-center text-sm"
      style={{
        border: '1px solid var(--terminal-border)',
        backgroundColor: 'var(--terminal-surface)',
        color: 'var(--text-tertiary)',
      }}
    >
      {children}
    </div>
  );
}

function FootNote() {
  return (
    <div
      className="rounded-xl p-4 text-[11px] space-y-1.5"
      style={{
        border: '1px solid var(--terminal-border)',
        backgroundColor: 'var(--terminal-surface)',
        color: 'var(--text-tertiary)',
      }}
    >
      <p>
        <strong style={{ color: 'var(--text-secondary)' }}>Why some rows have no price.</strong>{' '}
        Shop storefronts list each break as a product ahead of time, so they carry a spot price.
        Live platforms (Fanatics Live, Whatnot) publish no break list before a show starts — a
        named, product-specific show two days out still reads &ldquo;this shop is empty&rdquo;, and
        pre-claims happen by text. Titles still tell us which products are getting attention.
      </p>
      <p>
        <strong style={{ color: 'var(--text-secondary)' }}>Matching is strict on purpose.</strong>{' '}
        A miss shows up here as a gap to review; a false positive would quietly claim we can price
        something we can&rsquo;t. Chrome vs Cosmic Chrome, and 2025 vs 2026, are both treated as
        different products.
      </p>
    </div>
  );
}
