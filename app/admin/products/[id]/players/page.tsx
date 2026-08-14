import { supabaseAdmin } from '@/lib/supabase';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ChevronDown, Star } from 'lucide-react';
import ChecklistUpload from '@/components/admin/ChecklistUpload';
import PlayerBulkForm from '@/components/admin/PlayerBulkForm';
import PlayersManager, { type PlayerRow } from './PlayersManager';
import RosterSentimentEditor, { type SentimentRow } from './RosterSentimentEditor';
import type { Product, PlayerProduct, Player, Sport } from '@/lib/types';

export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ id: string }> };

export default async function AdminPlayersPage({ params }: PageProps) {
  const { id } = await params;

  const { data: product } = await supabaseAdmin
    .from('products')
    .select('*, sport:sports(*)')
    .eq('id', id)
    .single<Product & { sport: Sport }>();

  if (!product) notFound();

  const { data: playerProductsRaw } = await supabaseAdmin
    .from('player_products')
    .select('*, player:players(*)')
    .eq('product_id', id)
    .order('id') as { data: (PlayerProduct & { player: Player })[] | null };

  const playerProducts = playerProductsRaw ?? [];

  // Player-global attributes (icon / HV / risk flags) moved to /admin/players
  // in the 2026-06-02 re-model — this page is now the product roster only.
  const players: PlayerRow[] = playerProducts
    .filter(pp => pp.player?.name)
    .map(pp => ({
      playerProductId: pp.id,
      playerId: pp.player_id!,
      name: pp.player?.name ?? '',
      team: pp.player?.team ?? '',
      isRookie: !!pp.player?.is_rookie,
      hobbySets: pp.hobby_sets ?? 0,
      bdOnlySets: pp.bd_only_sets ?? 0,
      insertOnly: !!pp.insert_only,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Per-product sentiment rows for the Roster Sentiment editor. Same roster,
  // carrying the current breakerz_score / breakerz_note so the grid is
  // pre-populated (the engine reads these via computeEffectiveScore).
  const sentimentRows: SentimentRow[] = playerProducts
    .filter(pp => pp.player?.name)
    .map(pp => ({
      playerProductId: pp.id,
      name: pp.player?.name ?? '',
      team: pp.player?.team ?? '',
      isRookie: !!pp.player?.is_rookie,
      insertOnly: !!pp.insert_only,
      score: pp.breakerz_score ?? 0,
      note: pp.breakerz_note ?? '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      {/* Compact header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/products"
            className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors hover:bg-[var(--terminal-surface-hover)]"
            style={{ border: '1px solid var(--terminal-border)', color: 'var(--text-secondary)' }}
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-0.5">
              {product.sport?.name} · {product.year}
            </p>
            <h1 className="text-2xl font-black leading-tight">{product.name}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Product roster</p>
          </div>
        </div>
        <Link
          href={`/admin/products/${id}`}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back to product dashboard
        </Link>
      </div>

      {/* Icon / High-Volatility / Risk flags are player-global now — managed
          from the global directory, not per product. */}
      <Link
        href="/admin/players"
        className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg border transition-colors hover:bg-[var(--terminal-surface-hover)]"
        style={{ borderColor: 'var(--terminal-border)', color: 'var(--text-secondary)' }}
      >
        <Star className="w-4 h-4" style={{ color: '#a855f7' }} />
        Manage player attributes (icon · high-volatility · risk flags) in the global Players directory →
      </Link>

      {/* Roster Sentiment — per-product ± score editor over the full checklist.
          The pre-release "assign a score to every player" surface (2026-08-14
          Kyle call). Writes player_products.breakerz_score, read by the engine. */}
      <div
        className="rounded-lg border p-4"
        style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
      >
        <RosterSentimentEditor productId={id} players={sentimentRows} />
      </div>

      {/* Product roster — read-only reference (set counts / insert-only) */}
      <details
        className="rounded-lg border overflow-hidden group"
        style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
      >
        <summary className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[var(--terminal-surface-hover)] list-none">
          <div>
            <h2 className="text-sm font-semibold">Roster reference</h2>
            <p className="text-xs text-muted-foreground">Read-only — set counts, insert-only flags</p>
          </div>
          <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180 text-muted-foreground" />
        </summary>
        <div className="px-4 py-4 border-t" style={{ borderColor: 'var(--terminal-border)' }}>
          <PlayersManager players={players} />
        </div>
      </details>

      {/* Add players — collapsed by default */}
      <details
        className="rounded-lg border overflow-hidden group"
        style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
      >
        <summary className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[var(--terminal-surface-hover)] list-none">
          <div>
            <h2 className="text-sm font-semibold">Import Checklist</h2>
            <p className="text-xs text-muted-foreground">PDF or CSV upload — auto-creates players and variants</p>
          </div>
          <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180 text-muted-foreground" />
        </summary>
        <div className="px-4 py-4 border-t" style={{ borderColor: 'var(--terminal-border)' }}>
          <ChecklistUpload
            productId={id}
            sportId={product.sport_id}
            productName={product.name}
          />
        </div>
      </details>

      <details
        className="rounded-lg border overflow-hidden group"
        style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
      >
        <summary className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[var(--terminal-surface-hover)] list-none">
          <div>
            <h2 className="text-sm font-semibold">Bulk Add Players Manually</h2>
            <p className="text-xs text-muted-foreground">Paste a list or fill in rows directly</p>
          </div>
          <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180 text-muted-foreground" />
        </summary>
        <div className="px-4 py-4 border-t" style={{ borderColor: 'var(--terminal-border)' }}>
          <PlayerBulkForm
            productId={id}
            sportId={product.sport_id}
          />
        </div>
      </details>
    </div>
  );
}
