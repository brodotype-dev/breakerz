'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Plus, X, Star, Zap, ChevronRight, Package } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  setPlayerIcon,
  setPlayerHighVolatility,
  addPlayerRiskFlag,
  clearPlayerRiskFlag,
} from './actions';

const FLAG_TYPES = [
  { value: 'injury', label: 'Injury', tone: 'amber' },
  { value: 'suspension', label: 'Suspension', tone: 'red' },
  { value: 'legal', label: 'Legal', tone: 'red' },
  { value: 'trade', label: 'Trade', tone: 'blue' },
  { value: 'retirement', label: 'Retirement', tone: 'gray' },
  { value: 'off_field', label: 'Off-field', tone: 'orange' },
] as const;

type FlagType = typeof FLAG_TYPES[number]['value'];

const flagToneStyles: Record<string, { bg: string; text: string }> = {
  amber: { bg: 'rgba(245, 158, 11, 0.12)', text: '#f59e0b' },
  red: { bg: 'rgba(239, 68, 68, 0.12)', text: '#ef4444' },
  blue: { bg: 'rgba(59, 130, 246, 0.12)', text: '#3b82f6' },
  gray: { bg: 'rgba(148, 163, 184, 0.15)', text: '#94a3b8' },
  orange: { bg: 'rgba(249, 115, 22, 0.12)', text: '#f97316' },
};
const flagLabelMap = new Map<string, string>(FLAG_TYPES.map(f => [f.value, f.label]));
const flagToneMap = new Map<string, string>(FLAG_TYPES.map(f => [f.value, f.tone]));

const lifecycleStyles: Record<string, { bg: string; text: string; label: string }> = {
  live: { bg: 'rgba(16, 185, 129, 0.12)', text: '#10b981', label: 'Live' },
  pre_release: { bg: 'rgba(59, 130, 246, 0.12)', text: '#3b82f6', label: 'Pre-release' },
  dormant: { bg: 'rgba(148, 163, 184, 0.15)', text: '#94a3b8', label: 'Dormant' },
};

export interface GlobalPlayerRow {
  playerId: string;
  name: string;
  team: string;
  sport: string | null;
  isRookie: boolean;
  isIcon: boolean;
  isHighVolatility: boolean;
  activeFlags: Array<{ id: string; flagType: string; note: string }>;
}

interface PlayerProductRow {
  productId: string;
  name: string;
  year: string | null;
  sport: string | null;
  lifecycle: string | null;
  isActive: boolean;
  insertOnly: boolean;
}

interface Props {
  initialManaged: GlobalPlayerRow[];
  sports: Array<{ id: string; name: string }>;
  products: Array<{ id: string; label: string }>;
}

const selectStyle: React.CSSProperties = {
  border: '1px solid var(--terminal-border)',
  backgroundColor: 'var(--terminal-surface)',
  color: 'var(--text-secondary)',
};

export default function GlobalPlayersManager({ initialManaged, sports, products }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [managed, setManaged] = useState<GlobalPlayerRow[]>(initialManaged);
  const [query, setQuery] = useState('');
  const [sportId, setSportId] = useState('');
  const [productId, setProductId] = useState('');
  const [rookie, setRookie] = useState<'all' | 'yes' | 'no'>('all');

  const [results, setResults] = useState<GlobalPlayerRow[]>([]);
  const [fetching, setFetching] = useState(false);
  const [truncated, setTruncated] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [flagEditorId, setFlagEditorId] = useState<string | null>(null);
  const [newFlagType, setNewFlagType] = useState<FlagType>('injury');
  const [newFlagNote, setNewFlagNote] = useState('');

  // Product expansion (click a name): which player's products are open + cache.
  const [openProductsId, setOpenProductsId] = useState<string | null>(null);
  const [productsCache, setProductsCache] = useState<Map<string, PlayerProductRow[]>>(new Map());
  const [productsLoading, setProductsLoading] = useState<Set<string>>(new Set());

  useEffect(() => { setManaged(initialManaged); }, [initialManaged]);

  const nameActive = query.trim().length >= 2;
  const filterActive = nameActive || !!sportId || !!productId || rookie !== 'all';

  const buildQs = useCallback(() => {
    const p = new URLSearchParams();
    if (query.trim().length >= 2) p.set('q', query.trim());
    if (sportId) p.set('sport', sportId);
    if (productId) p.set('productId', productId);
    if (rookie !== 'all') p.set('rookie', rookie);
    return p.toString();
  }, [query, sportId, productId, rookie]);

  // Debounced unified fetch whenever any filter is active.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!filterActive) { setResults([]); setTruncated(false); setFetching(false); return; }
    setFetching(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/players/search?${buildQs()}`);
        const json = await res.json().catch(() => null);
        setResults(json?.players ?? []);
        setTruncated(!!json?.truncated);
      } catch {
        setResults([]); setTruncated(false);
      } finally {
        setFetching(false);
      }
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [filterActive, buildQs]);

  const rows = filterActive ? results : managed;

  function patchRow(playerId: string, patch: Partial<GlobalPlayerRow>) {
    const apply = (list: GlobalPlayerRow[]) =>
      list.map(r => (r.playerId === playerId ? { ...r, ...patch } : r));
    setManaged(apply);
    setResults(apply);
  }

  const refresh = () => startTransition(() => router.refresh());

  async function reFetch() {
    if (!filterActive) return;
    try {
      const res = await fetch(`/api/admin/players/search?${buildQs()}`);
      const json = await res.json().catch(() => null);
      setResults(json?.players ?? []);
      setTruncated(!!json?.truncated);
    } catch { /* keep optimistic state */ }
  }

  async function toggleIcon(row: GlobalPlayerRow) {
    const next = !row.isIcon;
    patchRow(row.playerId, { isIcon: next });
    const result = await setPlayerIcon(row.playerId, next);
    if (result?.error) patchRow(row.playerId, { isIcon: row.isIcon });
    else if (filterActive) reFetch(); else refresh();
  }

  async function toggleHV(row: GlobalPlayerRow) {
    const next = !row.isHighVolatility;
    patchRow(row.playerId, { isHighVolatility: next });
    const result = await setPlayerHighVolatility(row.playerId, next);
    if (result?.error) patchRow(row.playerId, { isHighVolatility: row.isHighVolatility });
    else if (filterActive) reFetch(); else refresh();
  }

  async function handleAddFlag(row: GlobalPlayerRow) {
    if (!newFlagNote.trim()) return;
    setBusyId(row.playerId + ':flag');
    const result = await addPlayerRiskFlag(row.playerId, newFlagType, newFlagNote);
    setBusyId(null);
    if (!result?.error) {
      patchRow(row.playerId, {
        activeFlags: [...row.activeFlags, { id: `tmp-${Date.now()}`, flagType: newFlagType, note: newFlagNote.trim() }],
      });
      setFlagEditorId(null);
      setNewFlagNote('');
      if (filterActive) reFetch(); else refresh();
    }
  }

  async function handleClearFlag(row: GlobalPlayerRow, flagId: string) {
    setBusyId(flagId);
    const result = await clearPlayerRiskFlag(flagId);
    setBusyId(null);
    if (!result?.error) {
      patchRow(row.playerId, { activeFlags: row.activeFlags.filter(f => f.id !== flagId) });
      if (filterActive) reFetch(); else refresh();
    }
  }

  async function toggleProducts(playerId: string) {
    if (openProductsId === playerId) { setOpenProductsId(null); return; }
    setOpenProductsId(playerId);
    if (!productsCache.has(playerId)) {
      setProductsLoading(prev => new Set(prev).add(playerId));
      try {
        const res = await fetch(`/api/admin/players/${playerId}/products`);
        const json = await res.json().catch(() => null);
        setProductsCache(prev => new Map(prev).set(playerId, json?.products ?? []));
      } catch {
        setProductsCache(prev => new Map(prev).set(playerId, []));
      } finally {
        setProductsLoading(prev => { const s = new Set(prev); s.delete(playerId); return s; });
      }
    }
  }

  function clearFilters() {
    setQuery(''); setSportId(''); setProductId(''); setRookie('all');
  }

  const countLabel = useMemo(() => {
    if (filterActive) return `${rows.length}${truncated ? '+' : ''} match${rows.length === 1 ? '' : 'es'}`;
    return `${managed.length} managed`;
  }, [filterActive, rows.length, truncated, managed.length]);

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="flex items-center gap-2 flex-1 min-w-[220px] h-9 px-3 rounded-lg"
          style={selectStyle}
        >
          <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search any player by name…"
            className="flex-1 bg-transparent border-0 outline-none text-sm placeholder:text-muted-foreground"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <select value={sportId} onChange={e => setSportId(e.target.value)}
          className="h-9 px-2 rounded-lg text-sm outline-none cursor-pointer" style={selectStyle}>
          <option value="">All sports</option>
          {sports.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <select value={productId} onChange={e => setProductId(e.target.value)}
          className="h-9 px-2 rounded-lg text-sm outline-none cursor-pointer max-w-[220px]" style={selectStyle}>
          <option value="">All products</option>
          {products.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>

        <select value={rookie} onChange={e => setRookie(e.target.value as 'all' | 'yes' | 'no')}
          className="h-9 px-2 rounded-lg text-sm outline-none cursor-pointer" style={selectStyle}>
          <option value="all">All players</option>
          <option value="yes">Rookies only</option>
          <option value="no">Non-rookies</option>
        </select>

        {filterActive && (
          <button onClick={clearFilters}
            className="h-9 px-3 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground"
            style={selectStyle}>
            Clear
          </button>
        )}

        <div className="flex items-baseline gap-1.5 h-9 px-3 rounded-lg" style={selectStyle}>
          <span className="font-mono text-sm font-bold">{fetching ? '…' : rows.length}</span>
          <span className="text-xs text-muted-foreground">{countLabel}</span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground px-1">
        <span className="inline-flex items-center gap-1"><Star className="w-3 h-3" style={{ color: '#a855f7' }} />Icon · skips buzz multiplier</span>
        <span className="inline-flex items-center gap-1"><Zap className="w-3 h-3" style={{ color: '#f59e0b' }} />High Volatility</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#ef4444' }} />Risk Flag · consumer-visible</span>
        <span className="inline-flex items-center gap-1"><ChevronRight className="w-3 h-3" />Click a name for products</span>
      </div>

      {truncated && (
        <p className="text-[11px] px-1" style={{ color: '#f59e0b' }}>
          Showing the first {rows.length} matches — narrow the filters to see the rest.
        </p>
      )}

      {/* Table */}
      {rows.length === 0 ? (
        <div className="rounded-lg border p-10 text-center text-sm"
          style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)', color: 'var(--text-secondary)' }}>
          {filterActive
            ? (fetching ? 'Searching…' : 'No players match these filters.')
            : 'No players have attributes set yet. Search or filter to manage a player.'}
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden" style={{ borderColor: 'var(--terminal-border)' }}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-[110px]">Team</TableHead>
                <TableHead className="w-[90px]">Sport</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead className="w-[60px] text-center">HV</TableHead>
                <TableHead className="w-[60px] text-center">Icon</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(p => {
                const flagEditorOpen = flagEditorId === p.playerId;
                const productsOpen = openProductsId === p.playerId;
                const loadingProducts = productsLoading.has(p.playerId);
                const productList = productsCache.get(p.playerId);
                return (
                  <Fragment key={p.playerId}>
                    <TableRow>
                      <TableCell className="font-medium">
                        <button
                          onClick={() => toggleProducts(p.playerId)}
                          className="inline-flex items-center gap-1.5 text-left hover:text-[var(--accent-blue)] transition-colors"
                          title="Show products this player is in"
                        >
                          <ChevronRight className="w-3.5 h-3.5 shrink-0 transition-transform" style={{ transform: productsOpen ? 'rotate(90deg)' : 'none', color: 'var(--text-tertiary)' }} />
                          <span>{p.name}</span>
                          {p.isRookie && (
                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded tracking-wide"
                              style={{ backgroundColor: 'rgba(16, 185, 129, 0.12)', color: '#10b981' }} title="Rookie">RC</span>
                          )}
                        </button>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{p.team || '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{p.sport || '—'}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 flex-wrap">
                          {p.activeFlags.map(flag => {
                            const tone = flagToneStyles[flagToneMap.get(flag.flagType) ?? 'gray'];
                            return (
                              <span key={flag.id} title={flag.note}
                                className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
                                style={{ backgroundColor: tone.bg, color: tone.text }}>
                                {flagLabelMap.get(flag.flagType) ?? flag.flagType}
                                <button onClick={() => handleClearFlag(p, flag.id)}
                                  disabled={busyId === flag.id || flag.id.startsWith('tmp-')}
                                  className="opacity-60 hover:opacity-100 leading-none disabled:opacity-30" title="Clear flag">×</button>
                              </span>
                            );
                          })}
                          <button
                            onClick={() => {
                              const opening = !flagEditorOpen;
                              setFlagEditorId(opening ? p.playerId : null);
                              setNewFlagNote('');
                              if (opening) setNewFlagType('injury');
                            }}
                            className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded border border-dashed text-muted-foreground hover:text-foreground hover:border-foreground transition-colors uppercase tracking-wide">
                            <Plus className="w-2.5 h-2.5" /> Flag
                          </button>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <button onClick={() => toggleHV(p)}
                          title={p.isHighVolatility ? 'High Volatility on — click to remove' : 'Mark as High Volatility'}
                          className="inline-flex items-center justify-center w-7 h-7 rounded transition-colors"
                          style={{ backgroundColor: p.isHighVolatility ? 'rgba(245, 158, 11, 0.15)' : 'transparent', color: p.isHighVolatility ? '#f59e0b' : 'var(--text-disabled)' }}>
                          <Zap className="w-4 h-4" fill={p.isHighVolatility ? 'currentColor' : 'none'} />
                        </button>
                      </TableCell>
                      <TableCell className="text-center">
                        <button onClick={() => toggleIcon(p)}
                          title={p.isIcon ? 'Icon-tier — click to remove' : 'Mark as icon-tier (skips buzz multiplier)'}
                          className="inline-flex items-center justify-center w-7 h-7 rounded transition-colors"
                          style={{ backgroundColor: p.isIcon ? 'rgba(168, 85, 247, 0.15)' : 'transparent', color: p.isIcon ? '#a855f7' : 'var(--text-disabled)' }}>
                          <Star className="w-4 h-4" fill={p.isIcon ? 'currentColor' : 'none'} />
                        </button>
                      </TableCell>
                    </TableRow>

                    {productsOpen && (
                      <TableRow>
                        <TableCell colSpan={6} className="bg-muted/20">
                          <div className="py-1.5">
                            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
                              <Package className="w-3 h-3" /> Products
                            </div>
                            {loadingProducts ? (
                              <p className="text-xs text-muted-foreground">Loading…</p>
                            ) : !productList || productList.length === 0 ? (
                              <p className="text-xs text-muted-foreground">Not in any product.</p>
                            ) : (
                              <div className="flex flex-col gap-1">
                                {productList.map(pr => {
                                  const lc = lifecycleStyles[pr.lifecycle ?? ''] ?? null;
                                  return (
                                    <div key={pr.productId} className="flex items-center gap-2 text-sm flex-wrap">
                                      <span className={pr.isActive ? '' : 'opacity-50'} style={{ color: 'var(--text-primary)' }}>
                                        {pr.year ? `${pr.year} ` : ''}{pr.name}
                                      </span>
                                      {pr.sport && <span className="text-xs text-muted-foreground">{pr.sport}</span>}
                                      {lc && (
                                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded tracking-wide"
                                          style={{ backgroundColor: lc.bg, color: lc.text }}>{lc.label}</span>
                                      )}
                                      {!pr.isActive && (
                                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded tracking-wide"
                                          style={{ backgroundColor: 'rgba(148,163,184,0.15)', color: '#94a3b8' }}>Inactive</span>
                                      )}
                                      {pr.insertOnly && (
                                        <span className="text-[9px] uppercase px-1.5 py-0.5 rounded tracking-wide"
                                          style={{ backgroundColor: 'rgba(148,163,184,0.1)', color: 'var(--text-tertiary)' }}>insert-only</span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}

                    {flagEditorOpen && (
                      <TableRow>
                        <TableCell colSpan={6} className="bg-muted/20">
                          <div className="flex flex-col gap-2 py-1">
                            <div className="flex gap-2">
                              <select value={newFlagType} onChange={e => setNewFlagType(e.target.value as FlagType)}
                                className="text-xs px-2 py-1.5 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)] shrink-0">
                                {FLAG_TYPES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                              </select>
                              <input type="text" placeholder="Consumer note — factual, past tense, source + date"
                                value={newFlagNote} onChange={e => setNewFlagNote(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleAddFlag(p)}
                                className="flex-1 text-xs px-2 py-1.5 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)]" />
                              <button onClick={() => handleAddFlag(p)}
                                disabled={!newFlagNote.trim() || busyId === p.playerId + ':flag'}
                                className="text-xs font-bold px-3 py-1.5 rounded text-white disabled:opacity-30" style={{ background: 'var(--gradient-blue)' }}>
                                {busyId === p.playerId + ':flag' ? '…' : 'Add'}
                              </button>
                              <button onClick={() => { setFlagEditorId(null); setNewFlagNote(''); }}
                                className="text-xs px-2 py-1.5 rounded border text-muted-foreground hover:text-foreground">Cancel</button>
                            </div>
                            <p className="text-[10px] text-muted-foreground">
                              Example: &quot;Torn ACL, out for season (ESPN, March 2026)&quot;. Flags apply to this player across every product.
                            </p>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
