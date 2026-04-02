import Link from 'next/link';
import { TrendingUp, ArrowRight, Zap, Target, Sparkles, ChevronRight } from 'lucide-react';
import { supabaseAdmin } from '@/lib/supabase';
import type { Product, Sport } from '@/lib/types';

async function getProducts(): Promise<(Product & { sport: Sport })[]> {
  const { data } = await supabaseAdmin
    .from('products')
    .select('*, sport:sports(*)')
    .eq('is_active', true)
    .order('year', { ascending: false });
  return data ?? [];
}

function isPreRelease(releaseDate: string | null): boolean {
  if (!releaseDate) return false;
  return new Date(releaseDate + 'T00:00:00') > new Date();
}

function getSportKey(sportName: string): 'baseball' | 'basketball' | 'football' {
  const s = sportName.toLowerCase();
  if (s === 'basketball') return 'basketball';
  if (s === 'football') return 'football';
  return 'baseball';
}

const sportGradients = {
  baseball:   'var(--gradient-blue)',
  basketball: 'var(--gradient-orange)',
  football:   'var(--gradient-green)',
};

const sportColors = {
  baseball:   { primary: 'var(--sport-baseball-primary)',   secondary: 'var(--sport-baseball-secondary)' },
  basketball: { primary: 'var(--sport-basketball-primary)', secondary: 'var(--sport-basketball-secondary)' },
  football:   { primary: 'var(--sport-football-primary)',   secondary: 'var(--sport-football-secondary)' },
};

export default async function HomePage() {
  const products = await getProducts();
  const liveCount = products.filter(p => !isPreRelease(p.release_date)).length;
  const preReleaseCount = products.length - liveCount;

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--terminal-bg)' }}>

      {/* Status Bar */}
      <div
        className="border-b px-6 py-3 flex items-center justify-between backdrop-blur-sm"
        style={{
          borderColor: 'var(--terminal-border)',
          backgroundColor: 'rgba(19, 24, 32, 0.95)',
          position: 'sticky',
          top: 0,
          zIndex: 50,
        }}
      >
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ backgroundColor: 'var(--signal-buy)', boxShadow: 'var(--glow-green)' }}
            />
            <span className="terminal-label font-semibold" style={{ color: 'var(--signal-buy)' }}>
              {liveCount} LIVE
            </span>
          </div>
          {preReleaseCount > 0 && (
            <div className="terminal-label" style={{ color: 'var(--accent-orange)' }}>
              {preReleaseCount} PRE-RELEASE
            </div>
          )}
        </div>
        <div className="terminal-label">v2.1</div>
      </div>

      {/* Hero Section */}
      <div
        className="relative overflow-hidden"
        style={{
          background: 'var(--gradient-hero)',
          borderBottom: '1px solid var(--terminal-border)',
        }}
      >
        {/* Background photo */}
        <img
          src="https://images.unsplash.com/photo-1607310073276-9f48dec47340?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxzcG9ydHMlMjBtZW1vcmFiaWxpYSUyMGNhcmRzJTIwZGlzcGxheXxlbnwxfHx8fDE3NzQ1NTc4MzV8MA&ixlib=rb-4.1.0&q=80&w=1080"
          alt=""
          aria-hidden="true"
          fetchPriority="low"
          className="absolute inset-0 w-full h-full object-cover opacity-20"
        />
        {/* Background dot pattern */}
        <div
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage: 'radial-gradient(circle at 2px 2px, var(--accent-blue) 1px, transparent 0)',
            backgroundSize: '40px 40px',
          }}
        />
        {/* Blue glow */}
        <div
          className="absolute top-0 right-0 w-96 h-96 blur-3xl opacity-20"
          style={{ background: 'radial-gradient(circle, var(--accent-blue) 0%, transparent 70%)' }}
        />
        {/* Gold glow */}
        <div
          className="absolute bottom-0 left-0 w-96 h-96 blur-3xl opacity-20"
          style={{ background: 'radial-gradient(circle, var(--badge-icon) 0%, transparent 70%)' }}
        />

        {/* Content */}
        <div className="relative px-6 py-10 md:py-14 max-w-6xl mx-auto">
          <div className="text-center mb-8">
            {/* Brand */}
            <div className="flex items-center justify-center gap-3 mb-4">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{ background: 'var(--gradient-blue)', boxShadow: 'var(--glow-blue)' }}
              >
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <h1
                className="text-5xl md:text-6xl font-bold"
                style={{
                  background: 'linear-gradient(135deg, var(--text-primary) 0%, var(--accent-blue) 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                BreakIQ
              </h1>
            </div>

            <p className="text-xl md:text-2xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
              Your Terminal for Sports Card Breaks
            </p>
            <p className="text-base md:text-lg max-w-2xl mx-auto" style={{ color: 'var(--text-secondary)' }}>
              Real-time slot pricing, AI-powered deal analysis, and market intelligence for serious collectors
            </p>

            {/* CTA Buttons */}
            <div className="flex items-center justify-center gap-4 mt-8">
              <Link href="/analysis">
                <button
                  className="px-6 py-3 rounded-lg font-semibold text-base flex items-center gap-2 transition-all hover:scale-105"
                  style={{ background: 'var(--gradient-blue)', color: 'white', boxShadow: 'var(--glow-blue)' }}
                >
                  <Zap className="w-5 h-5" />
                  Analyze a Break
                  <ChevronRight className="w-5 h-5" />
                </button>
              </Link>
              <a href="#products">
                <button
                  className="px-6 py-3 rounded-lg font-semibold text-base flex items-center gap-2 border-2 transition-all hover:scale-105"
                  style={{
                    borderColor: 'var(--accent-blue)',
                    color: 'var(--accent-blue)',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  }}
                >
                  Browse Products
                  <ArrowRight className="w-5 h-5" />
                </button>
              </a>
            </div>
          </div>

          {/* Feature Pills */}
          <div className="flex flex-wrap items-center justify-center gap-4">
            {[
              { icon: Target,     text: 'Live Market Data', color: 'var(--signal-buy)' },
              { icon: TrendingUp, text: 'AI Deal Signals',  color: 'var(--accent-blue)' },
              { icon: Sparkles,   text: 'Social Currency',  color: 'var(--badge-icon)' },
            ].map(({ icon: Icon, text, color }) => (
              <div
                key={text}
                className="flex items-center gap-2 px-4 py-2 rounded-full border backdrop-blur-sm"
                style={{ backgroundColor: 'rgba(19, 24, 32, 0.6)', borderColor: 'var(--terminal-border-hover)' }}
              >
                <Icon className="w-4 h-4" style={{ color }} />
                <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Breakerz Sayz Promo */}
      <div className="px-6 py-8">
        <Link href="/analysis">
          <div
            className="relative overflow-hidden rounded-xl border-2 transition-all cursor-pointer group hover:scale-[1.02]"
            style={{
              borderColor: 'var(--accent-blue)',
              background: 'var(--gradient-card)',
              boxShadow: '0 4px 20px rgba(59, 130, 246, 0.1)',
            }}
          >
            <div className="relative p-6 md:p-8">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center"
                      style={{ background: 'var(--gradient-blue)', boxShadow: 'var(--glow-blue)' }}
                    >
                      <TrendingUp className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <span
                        className="text-sm font-bold uppercase tracking-wider"
                        style={{ color: 'var(--accent-blue)' }}
                      >
                        BREAKERZ SAYZ
                      </span>
                      <div className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>
                        Powered by AI
                      </div>
                    </div>
                  </div>

                  <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                    Get Instant Deal Analysis
                  </h2>
                  <p className="text-base mb-4" style={{ color: 'var(--text-secondary)' }}>
                    Enter any break price and get BUY/WATCH/PASS signals with analyst-grade narratives in seconds.
                  </p>

                  <div className="flex items-center gap-3">
                    {(['BUY', 'WATCH', 'PASS'] as const).map(s => (
                      <div
                        key={s}
                        className="px-3 py-1.5 rounded-md text-xs font-bold"
                        style={{
                          backgroundColor: `var(--signal-${s.toLowerCase()}-bg)`,
                          color: `var(--signal-${s.toLowerCase()})`,
                          border: `1px solid var(--signal-${s.toLowerCase()}-border)`,
                        }}
                      >
                        {s}
                      </div>
                    ))}
                  </div>
                </div>

                <ChevronRight
                  className="w-8 h-8 opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all"
                  style={{ color: 'var(--accent-blue)' }}
                />
              </div>
            </div>
          </div>
        </Link>
      </div>

      {/* Product Grid */}
      <div id="products" className="px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
              Active Products
            </h2>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Click any product to see detailed slot pricing and analysis
            </p>
          </div>
        </div>

        {products.length === 0 ? (
          <div
            className="rounded-xl border border-dashed p-12 text-center"
            style={{ borderColor: 'var(--terminal-border)', color: 'var(--text-secondary)' }}
          >
            <p className="font-semibold mb-1">No products yet</p>
            <p className="text-sm">Add sports and products via the Supabase dashboard.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {products.map(product => {
              const sportKey = getSportKey(product.sport?.name ?? '');
              const gradient = sportGradients[sportKey];
              const { primary } = sportColors[sportKey];
              const preRelease = isPreRelease(product.release_date);

              return (
                <Link key={product.id} href={`/break/${product.slug}`}>
                  <div
                    className="relative overflow-hidden rounded-xl border transition-all cursor-pointer group hover:scale-[1.02]"
                    style={{
                      borderColor: 'var(--terminal-border)',
                      backgroundColor: 'var(--terminal-surface)',
                      boxShadow: 'var(--shadow-md)',
                    }}
                  >
                    {/* Sport gradient top bar */}
                    <div className="absolute top-0 left-0 right-0 h-1.5" style={{ background: gradient }} />

                    {/* Hover glow */}
                    <div
                      className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                      style={{ background: `radial-gradient(circle at center, ${primary}15 0%, transparent 70%)` }}
                    />

                    <div className="relative p-5 pt-6">
                      {/* Header Row */}
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span
                              className="text-xs font-bold uppercase px-2 py-1 rounded"
                              style={{
                                letterSpacing: '0.05em',
                                backgroundColor: `${primary}20`,
                                color: primary,
                              }}
                            >
                              {product.sport?.name}
                            </span>
                            <span className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                              {product.year}
                            </span>
                          </div>
                          <h3 className="text-lg font-bold leading-tight mb-1 truncate" style={{ color: 'var(--text-primary)' }}>
                            {product.name}
                          </h3>
                          <div className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                            {product.manufacturer}
                          </div>
                        </div>

                        {!preRelease && (
                          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full shrink-0 ml-2" style={{ backgroundColor: 'var(--signal-buy-bg)' }}>
                            <div
                              className="w-2 h-2 rounded-full animate-pulse"
                              style={{ backgroundColor: 'var(--signal-buy)', boxShadow: 'var(--glow-green)' }}
                            />
                            <span className="text-[9px] font-bold uppercase" style={{ color: 'var(--signal-buy)', letterSpacing: '0.06em' }}>
                              LIVE
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Case Cost */}
                      <div className="mb-4 p-4 rounded-lg" style={{ backgroundColor: 'rgba(59, 130, 246, 0.05)' }}>
                        <div className="terminal-label-muted mb-2">CASE COST</div>
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-2xl font-bold" style={{ color: primary }}>
                            ${product.hobby_case_cost?.toLocaleString() ?? '—'}
                          </span>
                          {product.bd_case_cost && (
                            <>
                              <span style={{ color: 'var(--text-tertiary)' }}>·</span>
                              <span className="font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>
                                BD ${product.bd_case_cost.toLocaleString()}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Status / CTA */}
                      {preRelease ? (
                        <div
                          className="text-center py-2 px-3 rounded-lg text-sm font-bold"
                          style={{
                            backgroundColor: 'var(--signal-watch-bg)',
                            color: 'var(--signal-watch)',
                            border: '1px solid var(--signal-watch-border)',
                          }}
                        >
                          PRE-RELEASE · Coming Soon
                        </div>
                      ) : (
                        <div
                          className="flex items-center justify-between py-2 px-3 rounded-lg transition-all"
                          style={{
                            backgroundColor: `${primary}15`,
                            borderLeft: `3px solid ${primary}`,
                          }}
                        >
                          <span className="text-sm font-semibold" style={{ color: primary }}>View Slot Analysis</span>
                          <ChevronRight
                            className="w-5 h-5 group-hover:translate-x-1 transition-transform"
                            style={{ color: primary }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer Stats */}
      <div className="px-6 py-12 border-t" style={{ borderColor: 'var(--terminal-border)' }}>
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
          <div>
            <div
              className="text-4xl font-bold mb-2"
              style={{ background: 'var(--gradient-blue)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
            >
              {liveCount}
            </div>
            <div className="terminal-label">Products Live</div>
          </div>
          <div>
            <div
              className="text-4xl font-bold mb-2"
              style={{ background: 'var(--gradient-green)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
            >
              AI
            </div>
            <div className="terminal-label">Deal Analysis</div>
          </div>
          <div>
            <div
              className="text-4xl font-bold mb-2"
              style={{ background: 'var(--gradient-orange)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
            >
              24/7
            </div>
            <div className="terminal-label">Market Tracking</div>
          </div>
        </div>
      </div>
    </div>
  );
}
