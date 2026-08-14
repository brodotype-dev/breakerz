'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X, Download, Upload } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { saveBreakerzBets } from '../../actions';

// Per-product pre-release sentiment editor. Writes player_products.breakerz_score
// (+ breakerz_note) — the per-product subjective layer the engine already reads
// via computeEffectiveScore. This is the "go down the checklist and assign a
// score to every player" surface from the 2026-08-14 Kyle call; the narrative-
// driven Insights Debrief only touches players you mention, this covers the
// whole roster. Reuses the existing bulk saveBreakerzBets action.

export interface SentimentRow {
  playerProductId: string;
  name: string;
  team: string;
  isRookie: boolean;
  insertOnly: boolean;
  score: number;
  note: string;
}

// Same pill ladder as the Insights Debrief so the two surfaces feel identical.
// CSV import accepts any numeric value (e.g. +0.2) for finer control.
const PILLS: { value: number; label: string; on: string }[] = [
  { value: -0.5, label: '−0.5', on: 'bg-red-600 text-white border-red-600' },
  { value: -0.25, label: '−0.25', on: 'bg-red-400 text-white border-red-400' },
  { value: 0, label: '0', on: 'bg-secondary text-foreground border-[var(--terminal-border)]' },
  { value: 0.25, label: '+0.25', on: 'bg-green-500 text-white border-green-500' },
  { value: 0.5, label: '+0.5', on: 'bg-green-600 text-white border-green-600' },
];

function isPill(v: number) {
  return PILLS.some(p => p.value === v);
}

interface Props {
  productId: string;
  players: SentimentRow[];
}

export default function RosterSentimentEditor({ productId, players }: Props) {
  const router = useRouter();
  // Original values keyed by ppId — the baseline we diff against for "changed".
  const original = useMemo(() => {
    const m = new Map<string, { score: number; note: string }>();
    for (const p of players) m.set(p.playerProductId, { score: p.score, note: p.note });
    return m;
  }, [players]);

  const [edits, setEdits] = useState<Map<string, { score: number; note: string }>>(
    () => new Map(original),
  );
  const [search, setSearch] = useState('');
  const [team, setTeam] = useState('all');
  const [hideInsertOnly, setHideInsertOnly] = useState(true);
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);

  const teams = useMemo(
    () => Array.from(new Set(players.map(p => p.team).filter(Boolean))).sort(),
    [players],
  );

  function edit(ppId: string, patch: Partial<{ score: number; note: string }>) {
    setEdits(prev => {
      const next = new Map(prev);
      const cur = next.get(ppId) ?? { score: 0, note: '' };
      next.set(ppId, { ...cur, ...patch });
      return next;
    });
    setSavedNote(null);
  }

  const isChanged = (ppId: string) => {
    const o = original.get(ppId);
    const e = edits.get(ppId);
    if (!o || !e) return false;
    return o.score !== e.score || (o.note ?? '') !== (e.note ?? '');
  };

  const changedIds = useMemo(
    () => players.filter(p => isChanged(p.playerProductId)).map(p => p.playerProductId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [edits, players, original],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return players.filter(p => {
      if (hideInsertOnly && p.insertOnly) return false;
      if (team !== 'all' && p.team !== team) return false;
      if (onlyChanged && !isChanged(p.playerProductId)) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, search, team, hideInsertOnly, onlyChanged, edits]);

  async function handleSave() {
    if (changedIds.length === 0) return;
    setSaving(true);
    setSavedNote(null);
    const updates = changedIds.map(ppId => {
      const e = edits.get(ppId)!;
      return { playerProductId: ppId, score: e.score, note: e.note ?? '' };
    });
    const res = await saveBreakerzBets(productId, updates);
    setSaving(false);
    if (res.error) {
      setSavedNote(`Error: ${res.error}`);
      return;
    }
    // Fold saved edits into the baseline so they're no longer "changed".
    for (const ppId of changedIds) original.set(ppId, { ...edits.get(ppId)! });
    setSavedNote(`Saved ${res.saved} player${res.saved === 1 ? '' : 's'}. Pricing reflects it on next refresh.`);
    router.refresh();
  }

  function exportCsv() {
    const rows = [['player', 'team', 'score', 'note']];
    for (const p of players) {
      const e = edits.get(p.playerProductId) ?? { score: p.score, note: p.note };
      rows.push([p.name, p.team, String(e.score ?? 0), (e.note ?? '').replace(/\n/g, ' ')]);
    }
    const csv = rows
      .map(r => r.map(c => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = linkRef.current!;
    a.href = url;
    a.download = 'roster-sentiment.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  // Paste "player,score,note" rows — matched to the roster by exact
  // (case-insensitive) name. Numeric score can be any value (e.g. 0.2).
  function applyImport() {
    const byName = new Map(players.map(p => [p.name.trim().toLowerCase(), p]));
    let matched = 0;
    const unmatched: string[] = [];
    for (const raw of importText.split('\n')) {
      const line = raw.trim();
      if (!line || /^player\s*,/i.test(line)) continue;
      const parts = line.split(',');
      const name = parts[0]?.trim();
      const score = parseFloat(parts[1] ?? '');
      const note = parts.slice(2).join(',').trim();
      if (!name || Number.isNaN(score)) continue;
      const p = byName.get(name.toLowerCase());
      if (!p) { unmatched.push(name); continue; }
      edit(p.playerProductId, { score, note: note || edits.get(p.playerProductId)?.note || '' });
      matched++;
    }
    setImportMsg(
      `Matched ${matched} row${matched === 1 ? '' : 's'}` +
        (unmatched.length ? ` · ${unmatched.length} unmatched: ${unmatched.slice(0, 8).join(', ')}${unmatched.length > 8 ? '…' : ''}` : '') +
        '. Review, then Save all.',
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-semibold">Roster Sentiment</h2>
          <p className="text-xs text-muted-foreground">
            Per-product ± score per player (pre-release hype / fade). Feeds the pricing engine directly.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCsv}
            className="flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium hover:bg-[var(--terminal-surface-hover)]"
            style={{ border: '1px solid var(--terminal-border)', color: 'var(--text-secondary)' }}
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
          <button
            onClick={() => setImportOpen(o => !o)}
            className="flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium hover:bg-[var(--terminal-surface-hover)]"
            style={{ border: '1px solid var(--terminal-border)', color: 'var(--text-secondary)' }}
          >
            <Upload className="w-3.5 h-3.5" /> Import CSV
          </button>
        </div>
      </div>

      {importOpen && (
        <div
          className="rounded-lg border p-3 space-y-2"
          style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
        >
          <p className="text-xs text-muted-foreground">
            Paste rows as <code>player,score,note</code> (one per line). Matched by name; unmatched are reported. Score can be any number.
          </p>
          <textarea
            value={importText}
            onChange={e => setImportText(e.target.value)}
            rows={5}
            placeholder={'Cooper Flagg,0.5,singular chase\nDylan Harper,0.25,'}
            className="w-full rounded-md p-2 text-sm font-mono bg-transparent outline-none"
            style={{ border: '1px solid var(--terminal-border)' }}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={applyImport}
              className="h-8 px-3 rounded-lg text-xs font-medium bg-[var(--accent-blue)] text-white"
            >
              Stage import
            </button>
            {importMsg && <span className="text-xs text-muted-foreground">{importMsg}</span>}
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="flex items-center gap-2 flex-1 min-w-[220px] h-9 px-3 rounded-lg"
          style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
        >
          <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search player or team…"
            className="flex-1 bg-transparent border-0 outline-none text-sm placeholder:text-muted-foreground"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <select
          value={team}
          onChange={e => setTeam(e.target.value)}
          className="h-9 px-3 rounded-lg text-xs font-medium bg-[var(--terminal-surface)]"
          style={{ border: '1px solid var(--terminal-border)' }}
        >
          <option value="all">All teams</option>
          {teams.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <label
          className="flex items-center gap-2 h-9 px-3 rounded-lg text-xs font-medium cursor-pointer select-none"
          style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
        >
          <input type="checkbox" checked={hideInsertOnly} onChange={e => setHideInsertOnly(e.target.checked)} />
          Slot-eligible only
        </label>
        <label
          className="flex items-center gap-2 h-9 px-3 rounded-lg text-xs font-medium cursor-pointer select-none"
          style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
        >
          <input type="checkbox" checked={onlyChanged} onChange={e => setOnlyChanged(e.target.checked)} />
          Changed only
        </label>

        <div
          className="flex items-baseline gap-1.5 h-9 px-3 rounded-lg"
          style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
        >
          <span className="font-mono text-sm font-bold">{filtered.length}</span>
          <span className="text-xs text-muted-foreground">of {players.length}</span>
        </div>
      </div>

      {/* Grid */}
      <div className="border rounded-lg overflow-hidden" style={{ borderColor: 'var(--terminal-border)' }}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Player</TableHead>
              <TableHead className="w-[130px]">Team</TableHead>
              <TableHead className="w-[300px]">Sentiment</TableHead>
              <TableHead>Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(p => {
              const e = edits.get(p.playerProductId) ?? { score: 0, note: '' };
              const changed = isChanged(p.playerProductId);
              return (
                <TableRow
                  key={p.playerProductId}
                  style={changed ? { backgroundColor: 'rgba(59,130,246,0.06)' } : undefined}
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <span>{p.name}</span>
                      {p.isRookie && (
                        <span
                          className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded tracking-wide"
                          style={{ backgroundColor: 'rgba(16, 185, 129, 0.12)', color: '#10b981' }}
                          title="Rookie card"
                        >
                          RC
                        </span>
                      )}
                      {!isPill(e.score) && (
                        <span className="text-[10px] font-mono text-muted-foreground" title="Custom value from CSV">
                          {e.score > 0 ? `+${e.score}` : e.score}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{p.team || '—'}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {PILLS.map(pill => {
                        const active = e.score === pill.value;
                        return (
                          <button
                            key={pill.value}
                            onClick={() => edit(p.playerProductId, { score: pill.value })}
                            className={`px-2 py-1 rounded-md text-[11px] font-bold border transition-colors ${
                              active ? pill.on : 'text-muted-foreground hover:bg-[var(--terminal-surface-hover)]'
                            }`}
                            style={active ? undefined : { borderColor: 'var(--terminal-border)' }}
                          >
                            {pill.label}
                          </button>
                        );
                      })}
                    </div>
                  </TableCell>
                  <TableCell>
                    <input
                      value={e.note ?? ''}
                      onChange={ev => edit(p.playerProductId, { note: ev.target.value })}
                      placeholder="why…"
                      className="w-full bg-transparent border-0 outline-none text-sm placeholder:text-muted-foreground"
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Sticky-ish save bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-xs text-muted-foreground">
          {changedIds.length > 0
            ? `${changedIds.length} unsaved change${changedIds.length === 1 ? '' : 's'}`
            : savedNote ?? 'No unsaved changes.'}
        </span>
        <button
          onClick={handleSave}
          disabled={saving || changedIds.length === 0}
          className="h-9 px-4 rounded-lg text-sm font-semibold disabled:opacity-40"
          style={{ backgroundColor: 'var(--accent-blue)', color: 'white' }}
        >
          {saving ? 'Saving…' : `Save all${changedIds.length ? ` (${changedIds.length})` : ''}`}
        </button>
      </div>
      {savedNote && changedIds.length === 0 && (
        <p className="text-xs" style={{ color: savedNote.startsWith('Error') ? '#ef4444' : '#10b981' }}>
          {savedNote}
        </p>
      )}
      <a ref={linkRef} className="hidden" aria-hidden />
    </div>
  );
}
