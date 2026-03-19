'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';

type OddsResult = {
  updatedCount: number;
  matched: { subsetName: string; variantName: string; hobbyOdds: string; breakerOdds: string | null }[];
  unmatched: string[];
};

export default function OddsUpload({ productId }: { productId: string }) {
  const [status, setStatus] = useState<'idle' | 'parsing' | 'applying' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<OddsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handleFile(file: File) {
    setStatus('parsing');
    setResult(null);
    setError(null);

    try {
      // Step 1: parse the PDF
      const form = new FormData();
      form.append('file', file);
      const parseRes = await fetch('/api/admin/parse-odds', { method: 'POST', body: form });
      const parseJson = await parseRes.json();
      if (!parseRes.ok || parseJson.error) throw new Error(parseJson.error ?? 'Parse failed');

      // Step 2: apply odds to DB
      setStatus('applying');
      const applyRes = await fetch('/api/admin/apply-odds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, odds: parseJson.odds }),
      });
      const applyJson = await applyRes.json();
      if (!applyRes.ok || applyJson.error) throw new Error(applyJson.error ?? 'Apply failed');

      setResult(applyJson);
      setStatus('done');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStatus('error');
    }
  }

  function reset() {
    setStatus('idle');
    setResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="space-y-4">
      {status === 'idle' || status === 'error' ? (
        <div>
          <label className="flex items-center gap-3 cursor-pointer">
            <span className="rounded border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors">
              {status === 'error' ? 'Try Again' : 'Upload Odds PDF →'}
            </span>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </label>
          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        </div>
      ) : status === 'parsing' ? (
        <p className="text-sm text-muted-foreground">Parsing PDF…</p>
      ) : status === 'applying' ? (
        <p className="text-sm text-muted-foreground">Applying odds to variants…</p>
      ) : result ? (
        <div className="space-y-3">
          <div className="flex items-center gap-4 text-sm">
            <span className="text-green-600 font-medium">{result.matched.length} matched</span>
            {result.unmatched.length > 0 && (
              <span className="text-amber-500 font-medium">{result.unmatched.length} unmatched</span>
            )}
            <button onClick={reset} className="ml-auto text-xs text-muted-foreground hover:text-foreground">
              Upload another
            </button>
          </div>

          {result.matched.length > 0 && (
            <div className="rounded border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Variant</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">Hobby</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">Breaker</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {result.matched.map((m, i) => (
                    <tr key={i} className="hover:bg-muted/20">
                      <td className="px-3 py-1.5 font-medium">{m.variantName}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">1:{m.hobbyOdds}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                        {m.breakerOdds ? `1:${m.breakerOdds}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.unmatched.length > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50/50 p-3 space-y-1">
              <p className="text-xs font-medium text-amber-700">Unmatched odds rows</p>
              {result.unmatched.map((u, i) => (
                <p key={i} className="text-xs text-amber-600 font-mono">{u}</p>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
