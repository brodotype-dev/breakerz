'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { bulkAddPlayers } from '@/app/admin/products/actions';
import type { ParsedPlayer } from '@/app/api/admin/parse-checklist/route';

type PreviewRow = ParsedPlayer & { hobbySets: number; bdOnlySets: number };

type Props = {
  productId: string;
  sportId: string;
  productName: string;
};

type State = 'idle' | 'loading' | 'preview' | 'saving' | 'done';

export default function ChecklistUpload({ productId, sportId, productName }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>('idle');
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [savedCount, setSavedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function handleParse() {
    const file = fileRef.current?.files?.[0];
    if (!file) { setError('Select a PDF first.'); return; }

    setError(null);
    setState('loading');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('productName', productName);

    try {
      const res = await fetch('/api/admin/parse-checklist', { method: 'POST', body: formData });
      const json = await res.json();

      if (!res.ok || json.error) {
        setError(json.error ?? 'Parse failed');
        setState('idle');
        return;
      }

      const parsed: ParsedPlayer[] = json.players ?? [];
      setRows(parsed.map(p => ({ ...p, hobbySets: 1, bdOnlySets: 0 })));
      setState('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setState('idle');
    }
  }

  async function handleSave() {
    setState('saving');
    setError(null);

    const result = await bulkAddPlayers(productId, sportId, rows);

    if (result.error) {
      setError(result.error);
      setState('preview');
      return;
    }

    setSavedCount(result.added);
    setState('done');
    router.refresh();
  }

  function updateRow(i: number, patch: Partial<PreviewRow>) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }

  function removeRow(i: number) {
    setRows(prev => prev.filter((_, idx) => idx !== i));
  }

  if (state === 'done') {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-green-600">
          {savedCount} player{savedCount !== 1 ? 's' : ''} saved successfully.
        </p>
        <button
          onClick={() => { setState('idle'); setRows([]); if (fileRef.current) fileRef.current.value = ''; }}
          className="text-sm text-muted-foreground underline"
        >
          Upload another checklist
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        Import from PDF Checklist
      </h3>

      {/* File input + parse button */}
      <div className="flex items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf"
          disabled={state === 'loading' || state === 'saving'}
          className="text-sm text-muted-foreground file:mr-3 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium file:cursor-pointer"
        />
        <button
          onClick={handleParse}
          disabled={state === 'loading' || state === 'saving'}
          className="rounded bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {state === 'loading' ? 'Parsing…' : 'Parse with Claude →'}
        </button>
      </div>

      {state === 'loading' && (
        <p className="text-sm text-muted-foreground animate-pulse">
          Parsing checklist with Claude — this may take 10–20s for large PDFs…
        </p>
      )}

      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}

      {/* Preview table */}
      {(state === 'preview' || state === 'saving') && rows.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {rows.length} player{rows.length !== 1 ? 's' : ''} extracted — edit before saving.
          </p>

          <div className="overflow-x-auto rounded border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Name</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Team</th>
                  <th className="px-3 py-2 text-center font-medium text-muted-foreground">RC</th>
                  <th className="px-3 py-2 text-center font-medium text-muted-foreground">Hob</th>
                  <th className="px-3 py-2 text-center font-medium text-muted-foreground">BD</th>
                  <th className="px-3 py-2 text-center font-medium text-muted-foreground">Ins</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row, i) => (
                  <tr key={i} className="hover:bg-muted/20">
                    <td className="px-3 py-1.5">
                      <input
                        value={row.name}
                        onChange={e => updateRow(i, { name: e.target.value })}
                        className="w-full bg-transparent focus:outline-none focus:ring-1 focus:ring-primary rounded px-1"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        value={row.team}
                        onChange={e => updateRow(i, { team: e.target.value })}
                        className="w-full bg-transparent focus:outline-none focus:ring-1 focus:ring-primary rounded px-1"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={row.isRookie}
                        onChange={e => updateRow(i, { isRookie: e.target.checked })}
                        className="cursor-pointer"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <input
                        type="number"
                        min={1}
                        value={row.hobbySets}
                        onChange={e => updateRow(i, { hobbySets: Math.max(1, parseInt(e.target.value) || 1) })}
                        className="w-12 text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-primary rounded px-1"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <input
                        type="number"
                        min={0}
                        value={row.bdOnlySets}
                        onChange={e => updateRow(i, { bdOnlySets: Math.max(0, parseInt(e.target.value) || 0) })}
                        className="w-12 text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-primary rounded px-1"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={row.insertOnly}
                        onChange={e => updateRow(i, { insertOnly: e.target.checked })}
                        className="cursor-pointer"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <button
                        onClick={() => removeRow(i)}
                        className="text-muted-foreground hover:text-red-500 text-xs"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            onClick={handleSave}
            disabled={state === 'saving' || rows.length === 0}
            className="rounded bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {state === 'saving' ? 'Saving…' : `Save All ${rows.length} Players`}
          </button>
        </div>
      )}
    </div>
  );
}
