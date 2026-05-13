'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Heart } from 'lucide-react';

// Context that holds the set of player_ids the current user has saved, so
// every heart button on a page reads from one fetched set instead of asking
// the server per row. Pages that render player lists wrap their content in
// <ChaseSetProvider> with the visible player_ids; the heart button reads
// from the context if available.
//
// Outside a provider the heart still works — it just fetches its own initial
// state. That makes it safe to drop into a drawer or detail view that isn't
// part of the original list.

type ChaseSetCtx = {
  saved: Set<string>;
  toggle: (playerId: string, next: boolean) => void;
};

const ChaseContext = createContext<ChaseSetCtx | null>(null);

export function ChaseSetProvider({
  playerIds,
  children,
}: {
  playerIds: string[];
  children: React.ReactNode;
}) {
  const [saved, setSaved] = useState<Set<string>>(() => new Set());

  // Stabilize the dependency so we don't re-fetch every render.
  const idsKey = useMemo(() => playerIds.slice().sort().join(','), [playerIds]);

  useEffect(() => {
    // If there are no playerIds to hydrate, leave whatever the previous set
    // was — no visible hearts can read from it anyway.
    if (!idsKey) return;
    let cancelled = false;
    fetch(`/api/chase?ids=${encodeURIComponent(idsKey)}`)
      .then(r => (r.ok ? r.json() : { ids: [] }))
      .then(json => { if (!cancelled) setSaved(new Set<string>(json.ids ?? [])); })
      .catch(() => { /* leave set empty — heart starts unfilled */ });
    return () => { cancelled = true; };
  }, [idsKey]);

  const toggle = useCallback((playerId: string, next: boolean) => {
    setSaved(prev => {
      const out = new Set(prev);
      if (next) out.add(playerId); else out.delete(playerId);
      return out;
    });
  }, []);

  return (
    <ChaseContext.Provider value={{ saved, toggle }}>
      {children}
    </ChaseContext.Provider>
  );
}

interface Props {
  playerId: string;
  size?: 'sm' | 'md';
  className?: string;
  // Called after a successful POST/DELETE round-trip. Used by /chase to
  // refresh the list once a row has been removed.
  onToggled?: (next: boolean) => void;
}

// localStorage key gating the one-time "Saved — find them on My Chase" hint.
// Cheap-and-cheerful for beta — profile-column migration is queued post-beta.
const FIRST_SAVE_SEEN_KEY = 'breakiq_chase_first_save_seen';

export default function ChaseHeartButton({ playerId, size = 'sm', className, onToggled }: Props) {
  const ctx = useContext(ChaseContext);

  // Local state mirrors the context (when present) and otherwise self-hydrates.
  const [filledLocal, setFilledLocal] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);

  // First-save hint — fires once per browser, after the first successful save.
  // Surfaces the payoff ("find them on My Chase") that users otherwise have
  // to discover by hunting through the nav.
  const [showFirstSaveHint, setShowFirstSaveHint] = useState(false);

  const filled = ctx ? ctx.saved.has(playerId) : (filledLocal ?? false);

  // Self-hydrate when there's no provider (drawer-only usage).
  useEffect(() => {
    if (ctx) return;
    let cancelled = false;
    fetch(`/api/chase?ids=${encodeURIComponent(playerId)}`)
      .then(r => (r.ok ? r.json() : { ids: [] }))
      .then(json => { if (!cancelled) setFilledLocal((json.ids ?? []).includes(playerId)); })
      .catch(() => { if (!cancelled) setFilledLocal(false); });
    return () => { cancelled = true; };
  }, [ctx, playerId]);

  const onClick = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (pending) return;
    setPending(true);
    const next = !filled;

    // Optimistic flip
    if (ctx) ctx.toggle(playerId, next); else setFilledLocal(next);

    try {
      const res = next
        ? await fetch('/api/chase', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player_id: playerId }),
          })
        : await fetch(`/api/chase/${encodeURIComponent(playerId)}`, { method: 'DELETE' });

      if (!res.ok) throw new Error(String(res.status));
      onToggled?.(next);

      // First successful save in this browser → surface the payoff once.
      if (next) {
        try {
          if (window.localStorage.getItem(FIRST_SAVE_SEEN_KEY) !== '1') {
            window.localStorage.setItem(FIRST_SAVE_SEEN_KEY, '1');
            setShowFirstSaveHint(true);
            window.setTimeout(() => setShowFirstSaveHint(false), 4500);
          }
        } catch {
          // localStorage unavailable — silently skip the hint.
        }
      }
    } catch {
      // Revert on failure
      if (ctx) ctx.toggle(playerId, !next); else setFilledLocal(!next);
    } finally {
      setPending(false);
    }
  }, [ctx, filled, onToggled, pending, playerId]);

  const dim = size === 'md' ? 'w-4 h-4' : 'w-3.5 h-3.5';

  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={onClick}
        aria-label={filled ? 'Remove from chase list' : 'Add to chase list'}
        aria-pressed={filled}
        title={filled ? 'On your chase list — tap to remove' : 'Tap to add to your chase list'}
        className={`shrink-0 inline-flex items-center justify-center rounded-md p-1 transition-colors hover:bg-[var(--terminal-surface-hover)] ${className ?? ''}`}
        style={{ color: filled ? '#ef4444' : 'var(--text-disabled)', opacity: pending ? 0.6 : 1 }}
      >
        <Heart className={dim} fill={filled ? 'currentColor' : 'none'} strokeWidth={2} />
      </button>

      {showFirstSaveHint && (
        <a
          href="/chase"
          className="absolute left-full top-0 ml-2 z-30 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[10px] font-semibold shadow-lg flex items-center gap-1"
          style={{
            backgroundColor: 'var(--terminal-surface)',
            color: 'var(--text-primary)',
            border: '1px solid rgba(59,130,246,0.4)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
          onClick={e => e.stopPropagation()}
        >
          Saved — find them on My Chase
          <span aria-hidden="true">↗</span>
        </a>
      )}
    </span>
  );
}
