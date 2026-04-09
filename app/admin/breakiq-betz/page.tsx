import { supabaseAdmin } from '@/lib/supabase';
import { Sparkles, TrendingUp, Users } from 'lucide-react';
import GlobalBreakIQBetsDebrief from './GlobalBreakIQBetsDebrief';

export default async function BreakIQBetsPage() {
  // Fetch global stats
  const [
    { count: totalPlayers },
    { data: recentBets },
  ] = await Promise.all([
    supabaseAdmin
      .from('players')
      .select('*', { count: 'exact', head: true }),
    supabaseAdmin
      .from('player_products')
      .select('breakerz_score, breakerz_note, player:players(name, team), product:products(name)')
      .not('breakerz_score', 'is', null)
      .neq('breakerz_score', 0)
      .order('breakerz_score', { ascending: false })
      .limit(20),
  ]);

  const bullishCount = (recentBets ?? []).filter((b: any) => (b.breakerz_score ?? 0) > 0).length;
  const bearishCount = (recentBets ?? []).filter((b: any) => (b.breakerz_score ?? 0) < 0).length;

  return (
    <div className="max-w-7xl mx-auto space-y-8">

      {/* Hero Header */}
      <div
        className="relative overflow-hidden rounded-2xl p-8"
        style={{ background: 'var(--gradient-hero)', border: '1px solid var(--terminal-border)' }}
      >
        <div
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage: 'radial-gradient(circle at 2px 2px, #a855f7 1px, transparent 0)',
            backgroundSize: '40px 40px',
          }}
        />
        <div
          className="absolute top-0 right-0 w-96 h-96 blur-3xl opacity-20 pointer-events-none"
          style={{ background: 'radial-gradient(circle, #a855f7 0%, transparent 70%)' }}
        />

        <div className="relative">
          <div className="flex items-center gap-3 mb-6">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: 'var(--gradient-purple)',
                boxShadow: 'var(--glow-purple)',
              }}
            >
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
                BreakIQ Bets
              </h1>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                AI-powered market intelligence — scores apply across all products
              </p>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard
              label="Tracked Players"
              value={String(totalPlayers ?? 0)}
              gradient="var(--gradient-blue)"
              icon={Users}
            />
            <StatCard
              label="Bullish Bets"
              value={String(bullishCount)}
              gradient="var(--gradient-green)"
              icon={TrendingUp}
            />
            <StatCard
              label="Bearish Bets"
              value={String(bearishCount)}
              gradient="var(--gradient-orange)"
              icon={Sparkles}
            />
          </div>
        </div>
      </div>

      {/* Debrief Input */}
      <div
        className="relative overflow-hidden rounded-xl border p-6"
        style={{ backgroundColor: 'var(--terminal-surface)', borderColor: 'var(--terminal-border-hover)' }}
      >
        <div
          className="absolute top-0 right-0 w-64 h-64 blur-3xl opacity-10 pointer-events-none"
          style={{ background: 'radial-gradient(circle, #a855f7 0%, transparent 70%)' }}
        />
        <div className="relative">
          <div className="flex items-start gap-4 mb-5">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'var(--gradient-purple)', boxShadow: '0 0 20px rgba(168, 85, 247, 0.3)' }}
            >
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                Market Debrief
              </h2>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Tell Claude what you're seeing in the market. Scores update across every product each player appears in.
              </p>
            </div>
          </div>
          <GlobalBreakIQBetsDebrief />
        </div>
      </div>

      {/* Recent Bets Table */}
      {(recentBets?.length ?? 0) > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              Active Scores
            </h2>
            <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {recentBets?.length} scored players
            </div>
          </div>

          <div
            className="rounded-xl border overflow-hidden"
            style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
          >
            {/* Table Header */}
            <div
              className="grid grid-cols-12 gap-4 px-6 py-3 border-b text-xs font-bold uppercase tracking-wider"
              style={{
                borderColor: 'var(--terminal-border)',
                backgroundColor: 'var(--terminal-surface-hover)',
                color: 'var(--text-tertiary)',
              }}
            >
              <div className="col-span-3">Player</div>
              <div className="col-span-4">Product</div>
              <div className="col-span-3">Note</div>
              <div className="col-span-2 text-center">Score</div>
            </div>

            <div className="divide-y" style={{ borderColor: 'var(--terminal-border)' }}>
              {(recentBets ?? []).map((bet: any, i: number) => {
                const score = bet.breakerz_score ?? 0;
                const isPositive = score > 0;
                const scoreColor = isPositive ? 'var(--signal-buy)' : 'var(--signal-pass)';
                const scoreBg = isPositive ? 'rgba(34,197,94,0.1)' : 'rgba(220,38,38,0.1)';

                return (
                  <div
                    key={i}
                    className="grid grid-cols-12 gap-4 px-6 py-3 items-center transition-all hover:bg-[var(--terminal-surface-hover)]"
                    style={{ backgroundColor: 'var(--terminal-surface)' }}
                  >
                    <div className="col-span-3">
                      <p className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                        {(bet.player as any)?.name ?? '—'}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        {(bet.player as any)?.team ?? ''}
                      </p>
                    </div>
                    <div className="col-span-4">
                      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {(bet.product as any)?.name ?? '—'}
                      </p>
                    </div>
                    <div className="col-span-3">
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {bet.breakerz_note ?? '—'}
                      </p>
                    </div>
                    <div className="col-span-2 flex justify-center">
                      <span
                        className="px-2 py-1 rounded text-xs font-bold font-mono"
                        style={{ backgroundColor: scoreBg, color: scoreColor }}
                      >
                        {score > 0 ? '+' : ''}{score.toFixed(2)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  gradient,
  icon: Icon,
}: {
  label: string;
  value: string;
  gradient: string;
  icon: React.ElementType;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-xl p-5 backdrop-blur-sm"
      style={{ backgroundColor: 'rgba(19, 24, 32, 0.6)', border: '1px solid var(--terminal-border-hover)' }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />
        <div className="terminal-label-muted">{label}</div>
      </div>
      <div
        className="text-4xl font-bold font-mono"
        style={{ background: gradient, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}
      >
        {value}
      </div>
    </div>
  );
}
