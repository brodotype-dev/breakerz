'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Progress = { completed: number; total: number; auto: number; review: number };

export default function RunMatchingButton({ productId }: { productId: string }) {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState<Progress>({ completed: 0, total: 0, auto: 0, review: 0 });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const router = useRouter();

  async function run() {
    setStatus('running');
    setProgress({ completed: 0, total: 0, auto: 0, review: 0 });
    setErrorMsg(null);

    let offset = 0;
    let totalAuto = 0;
    let totalReview = 0;
    let grandTotal = 0;

    try {
      while (true) {
        const res = await fetch('/api/admin/match-cardhedger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId, offset }),
        });

        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        const json = await res.json();
        if (json.error) throw new Error(json.error);

        grandTotal = json.total;
        totalAuto += json.results.filter((r: { status: string }) => r.status === 'auto').length;
        totalReview += json.results.filter((r: { status: string }) => r.status === 'review').length;
        offset += json.processed;

        setProgress({
          completed: offset,
          total: grandTotal,
          auto: totalAuto,
          review: totalReview,
        });

        if (!json.hasMore) break;

        // Small pause between chunks to avoid hammering APIs.
        await new Promise(r => setTimeout(r, 300));
      }

      setStatus('done');
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unknown error');
      setStatus('error');
    }
  }

  if (status === 'running') {
    const pct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
    return (
      <div className="flex items-center gap-3">
        <div className="w-32 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {progress.completed} / {progress.total || '…'}
        </span>
      </div>
    );
  }

  if (status === 'done') {
    const noMatch = progress.total - progress.auto - progress.review;
    return (
      <span className="text-xs text-muted-foreground">
        ✓ {progress.auto} matched · {progress.review} low confidence · {noMatch} no match
        <button
          onClick={() => setStatus('idle')}
          className="ml-2 underline hover:text-foreground"
        >
          Run again
        </button>
      </span>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={run}
          className="rounded border px-4 py-2 text-sm font-medium text-red-500 hover:bg-muted transition-colors"
        >
          Retry Matching
        </button>
        {errorMsg && <span className="text-xs text-red-500">{errorMsg}</span>}
      </div>
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
