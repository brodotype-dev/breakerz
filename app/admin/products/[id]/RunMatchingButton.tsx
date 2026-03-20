'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RunMatchingButton({ productId }: { productId: string }) {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [summary, setSummary] = useState<{ auto: number; review: number; noMatch: number } | null>(null);
  const router = useRouter();

  async function run() {
    setStatus('running');
    setSummary(null);
    try {
      const res = await fetch('/api/admin/match-cardhedger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? 'Matching failed');

      const results: Array<{ status: string }> = json.results ?? [];
      setSummary({
        auto: results.filter(r => r.status === 'auto').length,
        review: results.filter(r => r.status === 'review').length,
        noMatch: results.filter(r => r.status === 'no-match').length,
      });
      setStatus('done');
      router.refresh();
    } catch (err) {
      console.error(err);
      setStatus('error');
    }
  }

  if (status === 'running') {
    return (
      <span className="rounded border px-4 py-2 text-sm font-medium text-muted-foreground cursor-wait">
        Matching with Claude…
      </span>
    );
  }

  if (status === 'done' && summary) {
    return (
      <span className="text-xs text-muted-foreground">
        ✓ {summary.auto} matched · {summary.review} review · {summary.noMatch} no match
        <button onClick={() => { setStatus('idle'); setSummary(null); }} className="ml-2 underline">
          Run again
        </button>
      </span>
    );
  }

  if (status === 'error') {
    return (
      <button
        onClick={run}
        className="rounded border px-4 py-2 text-sm font-medium text-red-500 hover:bg-muted transition-colors"
      >
        Matching failed — retry
      </button>
    );
  }

  return (
    <button
      onClick={run}
      className="rounded border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
    >
      Re-run Matching →
    </button>
  );
}
