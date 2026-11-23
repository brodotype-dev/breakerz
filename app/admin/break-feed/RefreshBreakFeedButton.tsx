'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { errText } from '@/lib/format-error';

interface Summary {
  sourcesProcessed: number;
  rowsSeen: number;
  rowsUpserted: number;
  matched: number;
  unmatchedSports: number;
  nonSportsSkipped: number;
  disappeared: number;
  errors?: Array<{ source: string; message: string }>;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; summary: Summary }
  | { kind: 'error'; msg: string };

export default function RefreshBreakFeedButton() {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const router = useRouter();

  async function run() {
    setStatus({ kind: 'running' });
    try {
      const res = await fetch('/api/admin/refresh-break-feed', { method: 'POST' });
      // A long route can time out at the platform and return HTML, so never
      // assume the body parses (CLAUDE.md gotcha #13).
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        setStatus({ kind: 'error', msg: errText(json?.error, `HTTP ${res.status}`) });
        return;
      }

      setStatus({ kind: 'done', summary: json as Summary });
      router.refresh();
    } catch (err) {
      setStatus({ kind: 'error', msg: errText(err, 'Refresh failed') });
    }
  }

  const running = status.kind === 'running';

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        onClick={run}
        disabled={running}
        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
        style={{
          border: '1px solid var(--terminal-border)',
          backgroundColor: 'var(--terminal-surface-hover)',
          color: 'var(--text-primary)',
        }}
      >
        <RefreshCw className={`w-4 h-4 ${running ? 'animate-spin' : ''}`} />
        {running ? 'Pulling sources…' : 'Refresh feed'}
      </button>

      {status.kind === 'done' && (
        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          {status.summary.rowsSeen} seen · {status.summary.matched} matched ·{' '}
          {status.summary.unmatchedSports} sports gaps ·{' '}
          {status.summary.nonSportsSkipped} non-sports
          {status.summary.disappeared > 0 && ` · ${status.summary.disappeared} came off the board`}
          {status.summary.errors && status.summary.errors.length > 0 && (
            <span style={{ color: 'var(--danger, #b4433a)' }}>
              {' '}· {status.summary.errors.length} source error(s)
            </span>
          )}
        </span>
      )}

      {status.kind === 'error' && (
        <span className="text-xs" style={{ color: 'var(--danger, #b4433a)' }}>
          {status.msg}
        </span>
      )}
    </div>
  );
}
