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

    try {
      const res = await fetch('/api/admin/match-cardhedger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
      });

      if (!res.ok || !res.body) throw new Error('Request failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const raw of lines) {
          if (!raw.trim()) continue;
          try {
            const msg = JSON.parse(raw);
            if (msg.type === 'total') {
              setProgress(p => ({ ...p, total: msg.count }));
            } else if (msg.type === 'result') {
              setProgress(p => ({
                completed: msg.completed,
                total: p.total,
                auto: p.auto + (msg.status === 'auto' ? 1 : 0),
                review: p.review + (msg.status === 'review' ? 1 : 0),
              }));
            } else if (msg.type === 'done') {
              setStatus('done');
              router.refresh();
            }
          } catch {
            // skip malformed lines
          }
        }
      }
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
        ✓ {progress.auto} matched · {progress.review} review · {noMatch} no match
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
