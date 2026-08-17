'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { errText } from '@/lib/format-error';

interface PlayerRef {
  id: string;
  name: string;
  team: string | null;
}

interface OverrideRow {
  player_product_id: string;
  value: number;
  note: string | null;
  set_by: string | null;
  set_at: string | null;
  player: PlayerRef | null;
  modeledEvMid: number | null;
}

interface Candidate {
  player_product_id: string;
  player: PlayerRef;
}

interface Props {
  productId: string;
}

export default function EvOverridesManager({ productId }: Props) {
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Add form
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [setBy, setSetBy] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/ev-overrides?productId=${productId}`);
      const json = await res.json().catch(() => null);
      if (!res.ok) { setError(errText(json?.error, `HTTP ${res.status}`)); return; }
      setOverrides(json.overrides ?? []);
      setError(null);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => { load(); }, [load]);

  // Debounced player search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (picked || query.trim().length < 2) { setCandidates([]); return; }
    searchTimer.current = setTimeout(async () => {
      const res = await fetch(`/api/admin/ev-overrides?productId=${productId}&q=${encodeURIComponent(query.trim())}`);
      const json = await res.json().catch(() => null);
      if (res.ok) setCandidates(json.candidates ?? []);
    }, 250);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [query, picked, productId]);

  const alreadyOverridden = new Set(overrides.map(o => o.player_product_id));

  function resetForm() {
    setQuery(''); setCandidates([]); setPicked(null);
    setValue(''); setNote(''); setSetBy('');
  }

  async function save() {
    if (!picked || !value) return;
    setBusy('save');
    setError(null);
    try {
      const res = await fetch('/api/admin/ev-overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player_product_id: picked.player_product_id,
          value: Number(value),
          note, set_by: setBy,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) { setError(errText(json?.error, `HTTP ${res.status}`)); return; }
      resetForm();
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function clearOverride(ppId: string) {
    setBusy(ppId);
    try {
      const res = await fetch(`/api/admin/ev-overrides?id=${ppId}`, { method: 'DELETE' });
      const json = await res.json().catch(() => null);
      if (!res.ok) { setError(errText(json?.error, `HTTP ${res.status}`)); return; }
      setOverrides(prev => prev.filter(o => o.player_product_id !== ppId));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        Set a base EV for a player the model mis-prices (expected to explode, or a
        base that doesn&apos;t match reality). Breaker markup + compression still
        apply on top, so the slot price ends up higher than the number you set.
        Takes effect immediately — no pricing refresh needed.
      </p>

      {error && (
        <p className="text-xs px-2 py-1.5 rounded" style={{ color: '#ef4444', backgroundColor: 'rgba(239,68,68,0.08)' }}>
          {error}
        </p>
      )}

      {/* Active overrides */}
      {loading ? (
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Loading overrides…</p>
      ) : overrides.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>No EV overrides set for this product.</p>
      ) : (
        <div className="space-y-2">
          {overrides.map(o => (
            <div
              key={o.player_product_id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
              style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface-hover)' }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {o.player?.name ?? '—'}
                  </span>
                  {o.player?.team && (
                    <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{o.player.team}</span>
                  )}
                  <span
                    className="text-xs font-mono font-bold px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: 'rgba(59,130,246,0.15)', color: 'var(--accent-blue)' }}
                  >
                    ${Number(o.value).toLocaleString()}
                  </span>
                  {o.modeledEvMid != null && (
                    <span className="text-[10px] font-mono" style={{ color: 'var(--text-tertiary)' }}>
                      model ${Number(o.modeledEvMid).toLocaleString()}
                    </span>
                  )}
                </div>
                {(o.note || o.set_by || o.set_at) && (
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                    {[
                      o.note,
                      o.set_by ? `by ${o.set_by}` : null,
                      o.set_at ? new Date(o.set_at).toLocaleDateString() : null,
                    ].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              <button
                onClick={() => clearOverride(o.player_product_id)}
                disabled={busy === o.player_product_id}
                className="text-xs px-2 py-1 rounded transition-all hover:bg-red-900/20"
                style={{ color: 'var(--text-tertiary)', border: '1px solid var(--terminal-border)' }}
              >
                {busy === o.player_product_id ? '…' : 'Clear'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add / edit form */}
      <div
        className="p-3 rounded-lg space-y-3"
        style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface-hover)' }}
      >
        <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Set an override</p>

        {/* Player picker */}
        {picked ? (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              {picked.player.name}
            </span>
            {picked.player.team && (
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{picked.player.team}</span>
            )}
            {alreadyOverridden.has(picked.player_product_id) && (
              <span className="text-[10px]" style={{ color: '#eab308' }}>replacing existing override</span>
            )}
            <button
              onClick={() => { setPicked(null); setQuery(''); }}
              className="text-xs px-2 py-0.5 rounded"
              style={{ border: '1px solid var(--terminal-border)', color: 'var(--text-secondary)' }}
            >
              change
            </button>
          </div>
        ) : (
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search player by name…"
              className="w-full text-xs px-2 py-1.5 rounded"
              style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-bg)', color: 'var(--text-primary)' }}
            />
            {candidates.length > 0 && (
              <div
                className="absolute z-10 mt-1 w-full rounded-lg overflow-hidden"
                style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-bg)' }}
              >
                {candidates.map(c => (
                  <button
                    key={c.player_product_id}
                    onClick={() => { setPicked(c); setCandidates([]); }}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-white/5 flex items-center gap-2"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    <span className="font-medium">{c.player.name}</span>
                    {c.player.team && <span style={{ color: 'var(--text-tertiary)' }}>{c.player.team}</span>}
                    {alreadyOverridden.has(c.player_product_id) && (
                      <span className="text-[10px] ml-auto" style={{ color: '#eab308' }}>has override</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider block mb-1" style={{ color: 'var(--text-tertiary)' }}>
              Base EV ($)
            </label>
            <input
              type="number"
              min="1"
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder="e.g. 350"
              className="w-full text-xs px-2 py-1.5 rounded font-mono"
              style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-bg)', color: 'var(--text-primary)' }}
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider block mb-1" style={{ color: 'var(--text-tertiary)' }}>
              Set by (optional)
            </label>
            <input
              type="text"
              value={setBy}
              onChange={e => setSetBy(e.target.value)}
              placeholder="Brody / Kyle"
              className="w-full text-xs px-2 py-1.5 rounded"
              style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-bg)', color: 'var(--text-primary)' }}
            />
          </div>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider block mb-1" style={{ color: 'var(--text-tertiary)' }}>
            Note (optional)
          </label>
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="e.g. expected to explode after call-up"
            className="w-full text-xs px-2 py-1.5 rounded"
            style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-bg)', color: 'var(--text-primary)' }}
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={busy === 'save' || !picked || !value}
            className="text-xs px-3 py-1.5 rounded"
            style={{ backgroundColor: 'var(--accent-blue)', color: 'white', opacity: busy === 'save' || !picked || !value ? 0.5 : 1 }}
          >
            {busy === 'save' ? 'Saving…' : 'Save override'}
          </button>
          {(picked || value || note || setBy) && (
            <button
              onClick={resetForm}
              className="text-xs px-3 py-1.5 rounded"
              style={{ border: '1px solid var(--terminal-border)', color: 'var(--text-secondary)' }}
            >
              Reset
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
