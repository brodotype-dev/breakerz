'use client';

import { useState } from 'react';
import BreakerComparison from '@/components/breakiq/BreakerComparison';
import type { PlayerWithPricing } from '@/lib/types';

export default function BreakerComparisonPanel({ productId }: { productId: string }) {
  const [players, setPlayers] = useState<PlayerWithPricing[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pricing?productId=${productId}`);
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? 'Failed to load pricing');
      setPlayers(json.players ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  }

  if (!players) {
    return (
      <div className="space-y-3">
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          Enter each breaker&apos;s asking price per slot to compare against model value.
        </p>
        <button
          onClick={load}
          disabled={loading}
          className="px-4 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-40"
          style={{ background: 'var(--gradient-blue)', color: 'white', boxShadow: 'var(--glow-blue)' }}
        >
          {loading ? 'Loading…' : 'Load Pricing →'}
        </button>
        {error && <p className="text-xs" style={{ color: 'var(--signal-pass)' }}>{error}</p>}
      </div>
    );
  }

  return <BreakerComparison players={players} />;
}
