import { supabaseAdmin } from '@/lib/supabase';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import ChecklistUpload from '@/components/admin/ChecklistUpload';
import PlayerBulkForm from '@/components/admin/PlayerBulkForm';
import PlayerFlagsManager from './PlayerFlagsManager';
import type { Product, PlayerProduct, Player, Sport } from '@/lib/types';

type PageProps = { params: Promise<{ id: string }> };

export default async function AdminPlayersPage({ params }: PageProps) {
  const { id } = await params;

  const { data: product } = await supabaseAdmin
    .from('products')
    .select('*, sport:sports(*)')
    .eq('id', id)
    .single<Product & { sport: Sport }>();

  if (!product) notFound();

  const { data: playerProducts } = await supabaseAdmin
    .from('player_products')
    .select('*, player:players(*)')
    .eq('product_id', id)
    .order('id') as { data: (PlayerProduct & { player: Player })[] | null };

  const players = playerProducts ?? [];
  const ppIds = players.map(pp => pp.id);

  // Fetch active risk flags for this product's players
  const { data: riskFlags } = ppIds.length
    ? await supabaseAdmin
        .from('player_risk_flags')
        .select('id, player_product_id, flag_type, note')
        .in('player_product_id', ppIds)
        .is('cleared_at', null)
    : { data: [] };

  const flagsByPP = new Map<string, Array<{ id: string; flagType: string; note: string }>>();
  for (const f of riskFlags ?? []) {
    const list = flagsByPP.get(f.player_product_id) ?? [];
    list.push({ id: f.id, flagType: f.flag_type, note: f.note });
    flagsByPP.set(f.player_product_id, list);
  }

  const flagPlayers = players
    .filter(pp => !pp.insert_only && pp.player?.name)
    .map(pp => ({
      playerProductId: pp.id,
      playerId: pp.player_id,
      name: pp.player?.name ?? '',
      team: pp.player?.team ?? '',
      isIcon: (pp.player as any)?.is_icon ?? false,
      isHighVolatility: (pp as any).is_high_volatility ?? false,
      activeFlags: flagsByPP.get(pp.id) ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/admin/products" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← Products
          </Link>
          <div className="text-right">
            <p className="text-sm font-semibold">{product.name}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
              {product.sport?.name} · {product.year} · Admin
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Existing players */}
        {players.length > 0 && (
          <div className="bg-card border rounded overflow-hidden">
            <div className="h-1 bg-[var(--topps-red)]" />
            <div className="p-4">
              <p className="text-sm font-medium mb-3">
                {players.length} player{players.length !== 1 ? 's' : ''} in roster
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="pb-2 text-left font-medium text-muted-foreground">Name</th>
                      <th className="pb-2 text-left font-medium text-muted-foreground">Team</th>
                      <th className="pb-2 text-center font-medium text-muted-foreground">RC</th>
                      <th className="pb-2 text-center font-medium text-muted-foreground">Hobby Sets</th>
                      <th className="pb-2 text-center font-medium text-muted-foreground">BD Only</th>
                      <th className="pb-2 text-center font-medium text-muted-foreground">Insert</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {players.map(pp => (
                      <tr key={pp.id} className="hover:bg-muted/20">
                        <td className="py-1.5">{pp.player?.name}</td>
                        <td className="py-1.5 text-muted-foreground">{pp.player?.team || '—'}</td>
                        <td className="py-1.5 text-center">{pp.player?.is_rookie ? '✓' : ''}</td>
                        <td className="py-1.5 text-center">{pp.hobby_sets}</td>
                        <td className="py-1.5 text-center">{pp.bd_only_sets}</td>
                        <td className="py-1.5 text-center">{pp.insert_only ? '✓' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Player flags: icon tier, high volatility, risk flags */}
        {flagPlayers.length > 0 && (
          <div className="bg-card border rounded overflow-hidden">
            <div className="h-1" style={{ background: 'oklch(0.52 0.22 27)' }} />
            <div className="p-4 space-y-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                  Player Flags &amp; Settings
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  <span className="font-semibold text-purple-600 dark:text-purple-400">★ Icon</span>
                  {' '}— skips buzz multiplier (structural demand already in EV).{' '}
                  <span className="font-semibold text-amber-600 dark:text-amber-400">⚡ High Volatility</span>
                  {' '}— market pricing is unusually uncertain.{' '}
                  <span className="font-semibold text-red-600 dark:text-red-400">⚑ Flag</span>
                  {' '}— consumer-visible risk disclosure (injury, suspension, etc.).
                </p>
              </div>
              <PlayerFlagsManager productId={id} players={flagPlayers} />
            </div>
          </div>
        )}

        {/* PDF Import */}
        <div className="bg-card border rounded overflow-hidden">
          <div className="h-1 bg-[var(--topps-red)]" />
          <div className="p-6">
            <ChecklistUpload
              productId={id}
              sportId={product.sport_id}
              productName={product.name}
            />
          </div>
        </div>

        {/* Manual bulk entry */}
        <div className="bg-card border rounded overflow-hidden">
          <div className="h-1 bg-muted" />
          <div className="p-6">
            <PlayerBulkForm
              productId={id}
              sportId={product.sport_id}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
