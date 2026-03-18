'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { bulkAddPlayers, type BulkPlayerRow } from '@/app/admin/products/actions';

type Props = { productId: string; sportId: string };

const emptyRow = (): BulkPlayerRow => ({
  name: '',
  team: '',
  isRookie: false,
  insertOnly: false,
  hobbySets: 1,
  bdOnlySets: 0,
});

export default function PlayerBulkForm({ productId, sportId }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState<BulkPlayerRow[]>([emptyRow()]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ added: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function updateRow(i: number, patch: Partial<BulkPlayerRow>) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }

  function addRow() {
    setRows(prev => [...prev, emptyRow()]);
  }

  function removeRow(i: number) {
    setRows(prev => prev.length === 1 ? [emptyRow()] : prev.filter((_, idx) => idx !== i));
  }

  async function handleSave() {
    const filled = rows.filter(r => r.name.trim());
    if (!filled.length) { setError('Enter at least one player name.'); return; }

    setSaving(true);
    setError(null);
    setResult(null);

    const res = await bulkAddPlayers(productId, sportId, filled);

    setSaving(false);

    if (res.error) {
      setError(res.error);
    } else {
      setResult({ added: res.added });
      setRows([emptyRow()]);
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        Manual Entry
      </h3>

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
                    placeholder="Player name"
                    className="w-full bg-transparent focus:outline-none focus:ring-1 focus:ring-primary rounded px-1 placeholder:text-muted-foreground/40"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    value={row.team}
                    onChange={e => updateRow(i, { team: e.target.value })}
                    placeholder="Team"
                    className="w-full bg-transparent focus:outline-none focus:ring-1 focus:ring-primary rounded px-1 placeholder:text-muted-foreground/40"
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

      <div className="flex items-center gap-3">
        <button
          onClick={addRow}
          className="text-sm text-muted-foreground hover:text-foreground underline"
        >
          + Add row
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Players'}
        </button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {result && (
        <p className="text-sm text-green-600">
          {result.added} player{result.added !== 1 ? 's' : ''} saved.
        </p>
      )}
    </div>
  );
}
