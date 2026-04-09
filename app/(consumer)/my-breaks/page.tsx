'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';
import { ClipboardList, Plus, Clock, ArrowLeft, Sparkles, Trophy, Meh, ThumbsDown, ChevronDown, Download, Upload } from 'lucide-react';
import { formatCurrency } from '@/lib/engine';
import type { Signal, Platform, BreakOutcome, BreakStatus } from '@/lib/types';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface Product {
  id: string;
  name: string;
  year: string;
  sport: { name: string };
  hobby_case_cost: number | null;
  bd_case_cost: number | null;
}

interface BreakRecord {
  id: string;
  product_id: string;
  team: string;
  break_type: 'hobby' | 'bd';
  num_cases: number;
  ask_price: number;
  platform: Platform;
  platform_other: string | null;
  snapshot_signal: Signal | null;
  snapshot_value_pct: number | null;
  snapshot_fair_value: number | null;
  snapshot_analysis: string | null;
  outcome: BreakOutcome | null;
  outcome_notes: string | null;
  status: BreakStatus;
  created_at: string;
  completed_at: string | null;
  product?: { id: string; name: string; year: string; slug: string; sport: { name: string } };
}

type View = 'list' | 'new' | 'log';

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: 'fanatics_live', label: 'Fanatics Live' },
  { value: 'whatnot', label: 'Whatnot' },
  { value: 'ebay', label: 'eBay' },
  { value: 'dave_adams', label: "Dave & Adam's" },
  { value: 'layton_sports', label: 'Layton Sports Cards' },
  { value: 'local_card_shop', label: 'Local Card Shop' },
  { value: 'other', label: 'Other / Private' },
];

const OUTCOME_OPTIONS: { value: BreakOutcome; label: string; icon: typeof Trophy; color: string }[] = [
  { value: 'win', label: 'Win', icon: Trophy, color: 'var(--signal-buy)' },
  { value: 'mediocre', label: 'Mediocre', icon: Meh, color: 'var(--signal-watch)' },
  { value: 'bust', label: 'Bust', icon: ThumbsDown, color: 'var(--signal-pass)' },
];

const signalColors: Record<Signal, string> = {
  BUY: 'var(--signal-buy)',
  WATCH: 'var(--signal-watch)',
  PASS: 'var(--signal-pass)',
};

const PLATFORM_LABELS: Record<Platform, string> = {
  fanatics_live: 'Fanatics Live',
  whatnot: 'Whatnot',
  ebay: 'eBay',
  dave_adams: "Dave & Adam's",
  layton_sports: 'Layton Sports Cards',
  local_card_shop: 'Local Card Shop',
  other: 'Other / Private',
};

function computeStats(breaks: BreakRecord[]) {
  const active = breaks.filter(b => b.status !== 'abandoned');
  const completed = breaks.filter(b => b.status === 'completed' && b.outcome);
  const totalSpent = active.reduce((sum, b) => sum + Number(b.ask_price), 0);

  // Subjective Success Rate: win=10, mediocre=5, bust=1, averaged
  const outcomeScores: Record<string, number> = { win: 10, mediocre: 5, bust: 1 };
  const scored = completed.map(b => outcomeScores[b.outcome!] ?? 5);
  const successRate = scored.length > 0
    ? scored.reduce((a, b) => a + b, 0) / scored.length
    : null;

  return {
    totalBreaks: active.length,
    totalSpent,
    successRate,
  };
}

function exportBreaksCSV(breaks: BreakRecord[]) {
  const headers = ['Date', 'Product', 'Team', 'Break Type', 'Cases', 'Ask Price', 'Platform', 'Signal', 'Fair Value', 'Value %', 'Outcome', 'Notes', 'Status'];
  const rows = breaks.filter(b => b.status !== 'abandoned').map(b => [
    new Date(b.created_at).toLocaleDateString(),
    b.product?.name ?? '',
    b.team,
    b.break_type,
    b.num_cases,
    b.ask_price,
    PLATFORM_LABELS[b.platform] ?? b.platform,
    b.snapshot_signal ?? '',
    b.snapshot_fair_value ?? '',
    b.snapshot_value_pct ? `${Number(b.snapshot_value_pct).toFixed(1)}%` : '',
    b.outcome ?? '',
    (b.outcome_notes ?? '').replace(/"/g, '""'),
    b.status,
  ]);

  const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `my-breaks-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadImportTemplate() {
  const headers = ['Product Name', 'Year', 'Team', 'Break Type (hobby/bd)', 'Cases', 'Ask Price', 'Platform (fanatics_live/whatnot/ebay/dave_adams/layton_sports/local_card_shop/other)', 'Outcome (win/mediocre/bust)', 'Notes'];
  const example = ['2025 Bowman Chrome', '2025', 'New York Yankees', 'hobby', '1', '125', 'whatnot', 'win', 'Pulled a nice auto'];
  const csv = [headers, example].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'breakiq-import-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export default function MyBreaksPage() {
  const [view, setView] = useState<View>('list');
  const [breaks, setBreaks] = useState<BreakRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    Promise.all([
      fetch('/api/my-breaks').then(r => r.json()),
      fetch('/api/analysis').then(r => r.json()),
    ]).then(([breaksData, productsData]) => {
      setBreaks(breaksData.breaks ?? []);
      setProducts(productsData.products ?? []);
      setLoading(false);
    });
  }, []);

  function refreshBreaks() {
    fetch('/api/my-breaks').then(r => r.json()).then(d => setBreaks(d.breaks ?? []));
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--terminal-bg)' }}>
        <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--accent-blue)', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--terminal-bg)' }}>
      {/* Hero header */}
      <div
        className="relative overflow-hidden border-b"
        style={{ background: 'var(--gradient-hero)', borderColor: 'var(--terminal-border)' }}
      >
        <div className="absolute inset-0 opacity-5" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, var(--accent-blue) 1px, transparent 0)', backgroundSize: '40px 40px' }} />
        <div className="relative px-6 py-6 max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: 'var(--gradient-blue)', boxShadow: 'var(--glow-blue)' }}>
              <ClipboardList className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>My Breaks</h1>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Track your breaks, see how you did</p>
            </div>
          </div>
          {view === 'list' && (
            <div className="flex gap-2">
              <button
                onClick={() => setView('new')}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold text-white transition-all hover:opacity-90"
                style={{ background: 'var(--gradient-blue)' }}
              >
                <Plus className="w-4 h-4" /> New Break
              </button>
              <button
                onClick={() => setView('log')}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all hover:opacity-80"
                style={{ backgroundColor: 'var(--terminal-surface)', color: 'var(--text-secondary)', border: '1px solid var(--terminal-border)' }}
              >
                <Clock className="w-4 h-4" /> Log Previous
              </button>
              {breaks.length > 0 && (
                <button
                  onClick={() => exportBreaksCSV(breaks)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-80"
                  style={{ backgroundColor: 'var(--terminal-surface)', color: 'var(--text-tertiary)', border: '1px solid var(--terminal-border)' }}
                  title="Export CSV"
                >
                  <Download className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
          {view !== 'list' && (
            <button
              onClick={() => setView('list')}
              className="flex items-center gap-1.5 text-sm font-medium"
              style={{ color: 'var(--text-secondary)' }}
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          )}
        </div>
      </div>

      <div className="px-6 py-6 max-w-5xl mx-auto">
        {view === 'list' && (
          <BreakList
            breaks={breaks}
            products={products}
            onRefresh={refreshBreaks}
          />
        )}
        {(view === 'new' || view === 'log') && (
          <BreakForm
            mode={view === 'new' ? 'new' : 'log'}
            products={products}
            onSaved={() => { refreshBreaks(); setView('list'); }}
            onCancel={() => setView('list')}
          />
        )}
      </div>
    </div>
  );
}

// ── Break List ────────────────────────────────────────────────────────────────

function BreakList({ breaks, products, onRefresh }: { breaks: BreakRecord[]; products: Product[]; onRefresh: () => void }) {
  const pending = breaks.filter(b => b.status === 'pending');
  const completed = breaks.filter(b => b.status === 'completed');

  const stats = computeStats(breaks);

  if (breaks.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed p-12 text-center" style={{ borderColor: 'var(--terminal-border)' }}>
        <ClipboardList className="w-12 h-12 mx-auto mb-4 opacity-20" style={{ color: 'var(--text-secondary)' }} />
        <p className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>No breaks logged yet</p>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Track your breaks to see how your spending compares to actual results over time.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg p-4 text-center" style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}>
          <p className="text-2xl font-bold font-mono" style={{ color: 'var(--text-primary)' }}>{stats.totalBreaks}</p>
          <p className="text-xs font-semibold uppercase tracking-wider mt-1" style={{ color: 'var(--text-tertiary)' }}>Breaks</p>
        </div>
        <div className="rounded-lg p-4 text-center" style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}>
          <p className="text-2xl font-bold font-mono" style={{ color: 'var(--text-primary)' }}>{formatCurrency(stats.totalSpent)}</p>
          <p className="text-xs font-semibold uppercase tracking-wider mt-1" style={{ color: 'var(--text-tertiary)' }}>Total Spent</p>
        </div>
        <div className="rounded-lg p-4 text-center" style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}>
          <p className="text-2xl font-bold font-mono" style={{ color: stats.successRate !== null ? (stats.successRate >= 7 ? 'var(--signal-buy)' : stats.successRate >= 4 ? 'var(--signal-watch)' : 'var(--signal-pass)') : 'var(--text-disabled)' }}>
            {stats.successRate !== null ? stats.successRate.toFixed(1) : '—'}
          </p>
          <p className="text-xs font-semibold uppercase tracking-wider mt-1" style={{ color: 'var(--text-tertiary)' }}>Success Rate</p>
        </div>
      </div>

      {pending.length > 0 && (
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
            Pending — How did it go?
          </h2>
          <div className="space-y-3">
            {pending.map(b => (
              <PendingBreakCard key={b.id} brk={b} onComplete={onRefresh} />
            ))}
          </div>
        </div>
      )}

      {completed.length > 0 && (
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
            Completed
          </h2>
          <div className="space-y-3">
            {completed.map(b => (
              <CompletedBreakCard key={b.id} brk={b} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pending Break Card ────────────────────────────────────────────────────────

function PendingBreakCard({ brk, onComplete }: { brk: BreakRecord; onComplete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [outcome, setOutcome] = useState<BreakOutcome | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleComplete() {
    if (!outcome) return;
    setSaving(true);
    const res = await fetch(`/api/my-breaks/${brk.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome, outcomeNotes: notes || null }),
    });
    if (res.ok) onComplete();
    setSaving(false);
  }

  async function handleDidntBuyIn() {
    setSaving(true);
    const res = await fetch(`/api/my-breaks/${brk.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ abandon: true }),
    });
    if (res.ok) onComplete();
    setSaving(false);
  }

  const platformLabel = PLATFORMS.find(p => p.value === brk.platform)?.label ?? brk.platform;

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}>
      <div className="p-4 flex items-center justify-between cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {brk.product?.name ?? 'Unknown Product'} — {brk.team}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            {formatCurrency(brk.ask_price)} · {platformLabel} · {new Date(brk.created_at).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {brk.snapshot_signal && (
            <span className="text-xs font-bold px-2 py-1 rounded" style={{ color: signalColors[brk.snapshot_signal], backgroundColor: `${signalColors[brk.snapshot_signal]}15` }}>
              {brk.snapshot_signal}
            </span>
          )}
          <span className="text-xs font-semibold px-2 py-1 rounded" style={{ backgroundColor: 'rgba(234,179,8,0.15)', color: 'var(--signal-watch)' }}>
            Pending
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} style={{ color: 'var(--text-tertiary)' }} />
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-4 pt-2 border-t space-y-4" style={{ borderColor: 'var(--terminal-border)' }}>
          {brk.snapshot_analysis && (
            <p className="text-sm italic pl-3 border-l-2" style={{ color: 'var(--text-secondary)', borderColor: 'var(--accent-blue)' }}>
              {brk.snapshot_analysis}
            </p>
          )}
          <div>
            <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>How did it go?</p>
            <div className="flex gap-2">
              {OUTCOME_OPTIONS.map(o => {
                const Icon = o.icon;
                const selected = outcome === o.value;
                return (
                  <button
                    key={o.value}
                    onClick={() => setOutcome(o.value)}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-bold transition-all"
                    style={{
                      backgroundColor: selected ? `${o.color}20` : 'var(--terminal-bg)',
                      border: `2px solid ${selected ? o.color : 'var(--terminal-border)'}`,
                      color: selected ? o.color : 'var(--text-tertiary)',
                    }}
                  >
                    <Icon className="w-4 h-4" />
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Notes (optional) — what did you pull? How do you feel about it?"
            rows={2}
            className="w-full rounded-lg border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
            style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-bg)', color: 'var(--text-primary)' }}
          />
          <div className="flex gap-3">
            <button
              onClick={handleDidntBuyIn}
              disabled={saving}
              className="px-4 py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-80 disabled:opacity-40"
              style={{ backgroundColor: 'var(--terminal-bg)', color: 'var(--text-tertiary)', border: '1px solid var(--terminal-border)' }}
            >
              Didn{"'"}t buy in
            </button>
            <button
              onClick={handleComplete}
              disabled={!outcome || saving}
              className="flex-1 py-2.5 rounded-lg text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-40"
              style={{ background: 'var(--gradient-blue)' }}
            >
              {saving ? 'Saving…' : 'Complete Break'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Completed Break Card ──────────────────────────────────────────────────────

function CompletedBreakCard({ brk }: { brk: BreakRecord }) {
  const outcomeOpt = OUTCOME_OPTIONS.find(o => o.value === brk.outcome);
  const platformLabel = PLATFORMS.find(p => p.value === brk.platform)?.label ?? brk.platform;

  return (
    <div className="rounded-lg p-4" style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {brk.product?.name ?? 'Unknown Product'} — {brk.team}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            {formatCurrency(brk.ask_price)} · {platformLabel} · {new Date(brk.created_at).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {brk.snapshot_signal && (
            <span className="text-xs font-mono" style={{ color: signalColors[brk.snapshot_signal] }}>
              {brk.snapshot_signal}
            </span>
          )}
          {outcomeOpt && (
            <span className="text-xs font-bold px-2 py-1 rounded" style={{ backgroundColor: `${outcomeOpt.color}15`, color: outcomeOpt.color }}>
              {outcomeOpt.label}
            </span>
          )}
        </div>
      </div>
      {brk.outcome_notes && (
        <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>{brk.outcome_notes}</p>
      )}
    </div>
  );
}

// ── Break Form (New + Log Previous) ──────────────────────────────────────────

function BreakForm({
  mode,
  products,
  onSaved,
  onCancel,
}: {
  mode: 'new' | 'log';
  products: Product[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [productId, setProductId] = useState('');
  const [teams, setTeams] = useState<string[]>([]);
  const [team, setTeam] = useState('');
  const [breakType, setBreakType] = useState<'hobby' | 'bd'>('hobby');
  const [numCases, setNumCases] = useState(1);
  const [askPrice, setAskPrice] = useState('');
  const [platform, setPlatform] = useState<Platform | ''>('');
  const [platformOther, setPlatformOther] = useState('');
  const [outcome, setOutcome] = useState<BreakOutcome | null>(null);
  const [outcomeNotes, setOutcomeNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<any | null>(null);

  // CSV import (log mode only)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportError(null);
    setImportSuccess(null);
    try {
      const text = await file.text();
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row');
      const rows = lines.slice(1).map(line => {
        const cols: string[] = [];
        let current = '';
        let inQuotes = false;
        for (const ch of line) {
          if (ch === '"') { inQuotes = !inQuotes; continue; }
          if (ch === ',' && !inQuotes) { cols.push(current.trim()); current = ''; continue; }
          current += ch;
        }
        cols.push(current.trim());
        return cols;
      });
      let imported = 0;
      for (const row of rows) {
        const [productName, , team, breakType, cases, askPrice, platform, outcome, notes] = row;
        if (!productName || !team || !askPrice) continue;
        const matchedProduct = products.find(p =>
          p.name.toLowerCase().includes(productName.toLowerCase()) ||
          productName.toLowerCase().includes(p.name.toLowerCase())
        );
        if (!matchedProduct) continue;
        const validPlatform = PLATFORMS.find(p => p.value === platform)?.value ?? 'other';
        const validOutcome = (['win', 'mediocre', 'bust'] as const).find(o => o === outcome) ?? null;
        const res = await fetch('/api/my-breaks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: validOutcome ? 'log' : 'new',
            productId: matchedProduct.id,
            team,
            breakType: breakType === 'bd' ? 'bd' : 'hobby',
            numCases: parseInt(cases) || 1,
            askPrice: parseFloat(askPrice),
            platform: validPlatform,
            outcome: validOutcome,
            outcomeNotes: notes || undefined,
          }),
        });
        if (res.ok) imported++;
      }
      setImportSuccess(`Imported ${imported} of ${rows.length} breaks`);
      onSaved();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  useEffect(() => {
    if (!productId) { setTeams([]); setTeam(''); return; }
    setTeam('');
    supabase
      .from('player_products')
      .select('player:players(team)')
      .eq('product_id', productId)
      .then(({ data }) => {
        const unique = Array.from(
          new Set((data ?? []).map((r: any) => r.player?.team).filter(Boolean))
        ).sort() as string[];
        setTeams(unique);
      });
  }, [productId]);

  const selectedProduct = products.find(p => p.id === productId);
  const hasBD = selectedProduct?.bd_case_cost != null;

  const canSubmit = productId && team && askPrice && platform && !submitting
    && (mode === 'new' || outcome);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/my-breaks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          productId,
          team,
          breakType,
          numCases,
          askPrice: parseFloat(askPrice),
          platform,
          platformOther: platform === 'other' ? platformOther : undefined,
          outcome: mode === 'log' ? outcome : undefined,
          outcomeNotes: mode === 'log' && outcomeNotes ? outcomeNotes : undefined,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      if (mode === 'new' && data.analysis) {
        setAnalysisResult(data.analysis);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto">
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}>
        <div className="h-1" style={{ background: mode === 'new' ? 'var(--gradient-blue)' : 'var(--gradient-green)' }} />
        <div className="p-6 space-y-5">
          <div>
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
              {mode === 'new' ? "I'm About to Break" : 'Log a Previous Break'}
            </h2>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              {mode === 'new'
                ? "We'll run a live analysis and save it. Come back after to log how it went."
                : 'Record a break you already did, or import from a CSV.'}
            </p>
          </div>

          {/* CSV Import zone (log mode only) */}
          {mode === 'log' && (
            <div
              className="border-2 border-dashed rounded-lg p-5 text-center"
              style={{ borderColor: 'var(--terminal-border)' }}
              onDrop={e => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file && file.name.endsWith('.csv')) {
                  const dt = new DataTransfer();
                  dt.items.add(file);
                  if (fileInputRef.current) {
                    fileInputRef.current.files = dt.files;
                    fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
                  }
                }
              }}
              onDragOver={e => e.preventDefault()}
            >
              <Upload className="w-8 h-8 mx-auto mb-2 opacity-30" style={{ color: 'var(--text-secondary)' }} />
              <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                {importing ? 'Importing…' : 'Import from CSV'}
              </p>
              <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
                Drop a file here or click to browse.{' '}
                <button onClick={() => downloadImportTemplate()} className="underline" style={{ color: 'var(--accent-blue)' }}>
                  Download template
                </button>
              </p>
              <label
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer transition-all hover:opacity-80"
                style={{ backgroundColor: 'var(--terminal-bg)', color: 'var(--text-secondary)', border: '1px solid var(--terminal-border)' }}
              >
                <Upload className="w-4 h-4" /> Choose File
                <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImport} disabled={importing} />
              </label>
              {importError && <p className="text-xs mt-2" style={{ color: 'var(--signal-pass)' }}>{importError}</p>}
              {importSuccess && <p className="text-xs mt-2" style={{ color: 'var(--signal-buy)' }}>{importSuccess}</p>}
            </div>
          )}

          <div className="relative flex items-center gap-3" style={{ color: 'var(--text-tertiary)' }}>
            {mode === 'log' && (
              <>
                <div className="flex-1 border-t" style={{ borderColor: 'var(--terminal-border)' }} />
                <span className="text-xs font-medium">or log one break</span>
                <div className="flex-1 border-t" style={{ borderColor: 'var(--terminal-border)' }} />
              </>
            )}
          </div>

          {/* Product */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Product</label>
            <select
              value={productId}
              onChange={e => setProductId(e.target.value)}
              className="w-full rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-bg)', color: 'var(--text-primary)' }}
            >
              <option value="">Select product…</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.year} {p.name}</option>)}
            </select>
          </div>

          {/* Team */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Team</label>
            <select
              value={team}
              onChange={e => setTeam(e.target.value)}
              disabled={!productId}
              className="w-full rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-40"
              style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-bg)', color: 'var(--text-primary)' }}
            >
              <option value="">{productId ? 'Select team…' : 'Select a product first'}</option>
              {teams.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* Break type + cases */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Break Type</label>
              <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--terminal-border)' }}>
                {['hobby', ...(hasBD ? ['bd'] : [])].map(bt => (
                  <button
                    key={bt}
                    onClick={() => setBreakType(bt as 'hobby' | 'bd')}
                    className="flex-1 py-2 text-sm font-bold transition-all"
                    style={{
                      backgroundColor: breakType === bt ? 'var(--accent-blue)' : 'transparent',
                      color: breakType === bt ? 'white' : 'var(--text-secondary)',
                    }}
                  >
                    {bt === 'hobby' ? 'Hobby' : 'BD'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Cases</label>
              <input
                type="number"
                value={numCases}
                onChange={e => setNumCases(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                min={1} max={50}
                className="w-full rounded-lg border px-3 py-2 text-sm font-mono text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-bg)', color: 'var(--text-primary)' }}
              />
            </div>
          </div>

          {/* Asking price */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
              {mode === 'new' ? 'What are you about to pay?' : 'What did you pay?'}
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-mono" style={{ color: 'var(--text-tertiary)' }}>$</span>
              <input
                type="number"
                placeholder="0"
                value={askPrice}
                onChange={e => setAskPrice(e.target.value)}
                className="w-full rounded-lg border pl-7 pr-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-bg)', color: 'var(--text-primary)' }}
              />
            </div>
          </div>

          {/* Platform */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Where?</label>
            <select
              value={platform}
              onChange={e => setPlatform(e.target.value as Platform)}
              className="w-full rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-bg)', color: 'var(--text-primary)' }}
            >
              <option value="">Select platform…</option>
              {PLATFORMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            {platform === 'other' && (
              <input
                type="text"
                placeholder="Where was this break?"
                value={platformOther}
                onChange={e => setPlatformOther(e.target.value)}
                className="w-full mt-2 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-bg)', color: 'var(--text-primary)' }}
              />
            )}
          </div>

          {/* Outcome (log mode only) */}
          {mode === 'log' && (
            <>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>How did it go?</label>
                <div className="flex gap-2">
                  {OUTCOME_OPTIONS.map(o => {
                    const Icon = o.icon;
                    const selected = outcome === o.value;
                    return (
                      <button
                        key={o.value}
                        onClick={() => setOutcome(o.value)}
                        className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-bold transition-all"
                        style={{
                          backgroundColor: selected ? `${o.color}20` : 'var(--terminal-bg)',
                          border: `2px solid ${selected ? o.color : 'var(--terminal-border)'}`,
                          color: selected ? o.color : 'var(--text-tertiary)',
                        }}
                      >
                        <Icon className="w-4 h-4" />
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <textarea
                value={outcomeNotes}
                onChange={e => setOutcomeNotes(e.target.value)}
                placeholder="Notes (optional) — what did you pull?"
                rows={2}
                className="w-full rounded-lg border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
                style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-bg)', color: 'var(--text-primary)' }}
              />
            </>
          )}

          {error && (
            <p className="text-sm" style={{ color: 'var(--signal-pass)' }}>{error}</p>
          )}

          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all"
              style={{ backgroundColor: 'var(--terminal-bg)', color: 'var(--text-secondary)', border: '1px solid var(--terminal-border)' }}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex-1 py-2.5 rounded-lg text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: 'var(--gradient-blue)' }}
            >
              {submitting ? 'Saving…' : (
                mode === 'new'
                  ? <><Sparkles className="w-4 h-4" /> Analyze & Save</>
                  : 'Save Break'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
