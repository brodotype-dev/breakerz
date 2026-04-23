'use client';

import { useState, useEffect, useCallback } from 'react';
import type { ChaseCard, ChaseCardType } from '@/lib/types';

interface RecommendedPlayer {
  id: string;
  buzz_score: number | null;
  player: { id: string; name: string; team: string; is_rookie: boolean };
  rarestVariant?: { id: string; variant_name: string; hobby_odds: number | null; card_number: string | null };
}

interface Recommendations {
  chaseCards: RecommendedPlayer[];
  chasePlayers: RecommendedPlayer[];
}

interface Props {
  productId: string;
}

function TypeBadge({ type }: { type: ChaseCardType }) {
  if (type === 'chase_card') {
    return (
      <span
        className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
        style={{ backgroundColor: 'rgba(168,85,247,0.15)', color: '#a855f7' }}
      >
        Chase Card
      </span>
    );
  }
  return (
    <span
      className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
      style={{ backgroundColor: 'rgba(59,130,246,0.15)', color: 'var(--accent-blue)' }}
    >
      Chase Player
    </span>
  );
}

function HitBadge() {
  return (
    <span
      className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
      style={{ backgroundColor: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
    >
      HIT
    </span>
  );
}

export default function ChaseCardsManager({ productId }: Props) {
  const [chaseCards, setChaseCards] = useState<ChaseCard[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendations>({ chaseCards: [], chasePlayers: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  // Add form state
  const [addMode, setAddMode] = useState(false);
  const [addType, setAddType] = useState<ChaseCardType>('chase_card');
  const [addPlayerProductId, setAddPlayerProductId] = useState('');
  const [addDisplayName, setAddDisplayName] = useState('');
  const [addOddsDisplay, setAddOddsDisplay] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/chase-cards?productId=${productId}`);
      const data = await res.json();
      setChaseCards(data.chaseCards ?? []);
      setRecommendations(data.recommendations ?? { chaseCards: [], chasePlayers: [] });
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => { load(); }, [load]);

  async function toggleHit(card: ChaseCard) {
    setSaving(card.id);
    try {
      const res = await fetch(`/api/admin/chase-cards/${card.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_hit: !card.is_hit }),
      });
      const data = await res.json();
      setChaseCards(prev => prev.map(c => c.id === card.id ? data.chaseCard : c));
    } finally {
      setSaving(null);
    }
  }

  async function removeCard(id: string) {
    setSaving(id);
    try {
      await fetch(`/api/admin/chase-cards/${id}`, { method: 'DELETE' });
      setChaseCards(prev => prev.filter(c => c.id !== id));
    } finally {
      setSaving(null);
    }
  }

  async function addFromRecommendation(pp: RecommendedPlayer, type: ChaseCardType) {
    setSaving('adding-' + pp.id);
    try {
      const oddsDisplay = pp.rarestVariant?.hobby_odds
        ? `1:${pp.rarestVariant.hobby_odds}`
        : '';
      const displayName = type === 'chase_card' && pp.rarestVariant
        ? pp.rarestVariant.variant_name
        : '';
      const res = await fetch('/api/admin/chase-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: productId,
          player_product_id: pp.id,
          type,
          display_name: displayName,
          odds_display: oddsDisplay,
        }),
      });
      const data = await res.json();
      setChaseCards(prev => [...prev, data.chaseCard]);
    } finally {
      setSaving(null);
    }
  }

  async function handleManualAdd() {
    if (!addPlayerProductId) return;
    setAdding(true);
    try {
      const res = await fetch('/api/admin/chase-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: productId,
          player_product_id: addPlayerProductId,
          type: addType,
          display_name: addDisplayName,
          odds_display: addOddsDisplay,
        }),
      });
      const data = await res.json();
      setChaseCards(prev => [...prev, data.chaseCard]);
      setAddMode(false);
      setAddPlayerProductId('');
      setAddDisplayName('');
      setAddOddsDisplay('');
    } finally {
      setAdding(false);
    }
  }

  const alreadyAddedIds = new Set(chaseCards.map(c => c.player_product_id));

  if (loading) {
    return (
      <div className="py-6 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
        Loading chase cards…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Current chase cards */}
      {chaseCards.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          No chase cards set yet. Add from recommendations below or manually.
        </p>
      ) : (
        <div className="space-y-2">
          {chaseCards.map(card => {
            const playerName = card.player_product?.player?.name ?? '—';
            const isSaving = saving === card.id;
            return (
              <div
                key={card.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                style={{
                  border: '1px solid var(--terminal-border)',
                  backgroundColor: card.is_hit ? 'rgba(239,68,68,0.06)' : 'var(--terminal-surface-hover)',
                }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {playerName}
                    </span>
                    <TypeBadge type={card.type} />
                    {card.is_hit && <HitBadge />}
                  </div>
                  {(card.display_name || card.odds_display) && (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                      {[card.display_name, card.odds_display ? `odds ${card.odds_display}` : null].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  {card.is_hit && card.hit_at && (
                    <p className="text-[10px] mt-0.5" style={{ color: '#ef4444' }}>
                      Self-reported hit · {new Date(card.hit_at).toLocaleDateString()}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => toggleHit(card)}
                    disabled={isSaving}
                    className="text-xs px-2.5 py-1 rounded transition-all"
                    style={{
                      border: '1px solid var(--terminal-border)',
                      color: card.is_hit ? '#ef4444' : 'var(--text-secondary)',
                      backgroundColor: card.is_hit ? 'rgba(239,68,68,0.1)' : 'transparent',
                    }}
                  >
                    {isSaving ? '…' : card.is_hit ? 'Unmark Hit' : 'Mark Hit'}
                  </button>
                  <button
                    onClick={() => removeCard(card.id)}
                    disabled={isSaving}
                    className="text-xs px-2 py-1 rounded transition-all hover:bg-red-900/20"
                    style={{ color: 'var(--text-tertiary)', border: '1px solid var(--terminal-border)' }}
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Hit disclaimer */}
      {chaseCards.some(c => c.is_hit) && (
        <p className="text-[10px] px-2" style={{ color: 'var(--text-tertiary)' }}>
          Hits are self-reported and not verified. Pricing is not automatically adjusted when a chase card is marked hit.
        </p>
      )}

      {/* Recommendations */}
      {(recommendations.chaseCards.length > 0 || recommendations.chasePlayers.length > 0) && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-tertiary)' }}>
            Recommended
          </p>
          <div className="space-y-4">
            {recommendations.chaseCards.length > 0 && (
              <div>
                <p className="text-[10px] mb-1.5" style={{ color: '#a855f7' }}>Chase Cards (rarest variants)</p>
                <div className="space-y-1">
                  {recommendations.chaseCards.map(pp => {
                    const already = alreadyAddedIds.has(pp.id);
                    const isSaving = saving === 'adding-' + pp.id;
                    return (
                      <div
                        key={pp.id}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg"
                        style={{ backgroundColor: 'var(--terminal-surface-hover)', border: '1px solid var(--terminal-border)' }}
                      >
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {pp.player?.name}
                          </span>
                          {pp.rarestVariant && (
                            <span className="ml-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                              {pp.rarestVariant.variant_name}
                              {pp.rarestVariant.hobby_odds ? ` · 1:${pp.rarestVariant.hobby_odds}` : ''}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => addFromRecommendation(pp, 'chase_card')}
                          disabled={already || isSaving}
                          className="text-xs px-2.5 py-1 rounded transition-all"
                          style={{
                            border: '1px solid var(--terminal-border)',
                            color: already ? 'var(--text-disabled)' : 'var(--text-secondary)',
                            opacity: already ? 0.5 : 1,
                          }}
                        >
                          {already ? 'Added' : isSaving ? '…' : '+ Add'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {recommendations.chasePlayers.length > 0 && (
              <div>
                <p className="text-[10px] mb-1.5" style={{ color: 'var(--accent-blue)' }}>Chase Players (highest buzz)</p>
                <div className="space-y-1">
                  {recommendations.chasePlayers.map(pp => {
                    const already = alreadyAddedIds.has(pp.id);
                    const isSaving = saving === 'adding-' + pp.id;
                    return (
                      <div
                        key={pp.id}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg"
                        style={{ backgroundColor: 'var(--terminal-surface-hover)', border: '1px solid var(--terminal-border)' }}
                      >
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {pp.player?.name}
                          </span>
                          {pp.buzz_score != null && (
                            <span className="ml-2 text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>
                              buzz {pp.buzz_score > 0 ? '+' : ''}{pp.buzz_score}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => addFromRecommendation(pp, 'chase_player')}
                          disabled={already || isSaving}
                          className="text-xs px-2.5 py-1 rounded transition-all"
                          style={{
                            border: '1px solid var(--terminal-border)',
                            color: already ? 'var(--text-disabled)' : 'var(--text-secondary)',
                            opacity: already ? 0.5 : 1,
                          }}
                        >
                          {already ? 'Added' : isSaving ? '…' : '+ Add'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Manual add */}
      <div>
        {!addMode ? (
          <button
            onClick={() => setAddMode(true)}
            className="text-xs px-3 py-1.5 rounded transition-all"
            style={{ border: '1px solid var(--terminal-border)', color: 'var(--text-secondary)' }}
          >
            + Add manually
          </button>
        ) : (
          <div
            className="p-3 rounded-lg space-y-3"
            style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface-hover)' }}
          >
            <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Add Chase Card / Player</p>
            <div className="space-y-2">
              <div>
                <label className="text-[10px] uppercase tracking-wider block mb-1" style={{ color: 'var(--text-tertiary)' }}>
                  Type
                </label>
                <select
                  value={addType}
                  onChange={e => setAddType(e.target.value as ChaseCardType)}
                  className="w-full text-xs px-2 py-1.5 rounded"
                  style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-bg)', color: 'var(--text-primary)' }}
                >
                  <option value="chase_card">Chase Card</option>
                  <option value="chase_player">Chase Player</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider block mb-1" style={{ color: 'var(--text-tertiary)' }}>
                  Player Product ID
                </label>
                <input
                  type="text"
                  value={addPlayerProductId}
                  onChange={e => setAddPlayerProductId(e.target.value)}
                  placeholder="UUID from player_products table"
                  className="w-full text-xs px-2 py-1.5 rounded font-mono"
                  style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-bg)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider block mb-1" style={{ color: 'var(--text-tertiary)' }}>
                  Display Name (optional)
                </label>
                <input
                  type="text"
                  value={addDisplayName}
                  onChange={e => setAddDisplayName(e.target.value)}
                  placeholder="e.g. 1/1 Gold Superfractor Auto"
                  className="w-full text-xs px-2 py-1.5 rounded"
                  style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-bg)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider block mb-1" style={{ color: 'var(--text-tertiary)' }}>
                  Odds Display (optional)
                </label>
                <input
                  type="text"
                  value={addOddsDisplay}
                  onChange={e => setAddOddsDisplay(e.target.value)}
                  placeholder="e.g. 1/1 or 1:360"
                  className="w-full text-xs px-2 py-1.5 rounded"
                  style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-bg)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleManualAdd}
                disabled={adding || !addPlayerProductId}
                className="text-xs px-3 py-1.5 rounded"
                style={{ backgroundColor: 'var(--accent-blue)', color: 'white', opacity: adding || !addPlayerProductId ? 0.5 : 1 }}
              >
                {adding ? 'Adding…' : 'Add'}
              </button>
              <button
                onClick={() => { setAddMode(false); setAddPlayerProductId(''); setAddDisplayName(''); setAddOddsDisplay(''); }}
                className="text-xs px-3 py-1.5 rounded"
                style={{ border: '1px solid var(--terminal-border)', color: 'var(--text-secondary)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
