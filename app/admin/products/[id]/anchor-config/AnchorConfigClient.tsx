'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AnchorStrategy } from '@/lib/pricing-anchors';
import type { AnchorConcept } from '@/lib/card-knowledge/types';

interface PreviewPlayerRow {
  playerProductId: string;
  playerName: string | null;
  currentEvMid: number;
  proposedEvMid: number;
  proposedMatched: number;
  proposedFellBack: boolean;
  nonHydrated: boolean;
}

interface Proposal {
  strategy: AnchorStrategy;
  patterns: string[];
  notes: string;
  rationale: string;
}

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  productId: string;
  productName: string;
  descriptorName: string;
  anchorConcepts: AnchorConcept[];
  initialStrategy: AnchorStrategy;
  initialPatterns: string[];
  initialNotes: string;
}

export default function AnchorConfigClient({
  productId,
  productName,
  descriptorName,
  anchorConcepts,
  initialStrategy,
  initialPatterns,
  initialNotes,
}: Props) {
  const router = useRouter();

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [proposal, setProposal] = useState<Proposal>({
    strategy: initialStrategy,
    patterns: initialPatterns,
    notes: initialNotes,
    rationale: '',
  });
  const [preview, setPreview] = useState<PreviewPlayerRow[]>([]);
  const [saved, setSaved] = useState(false);

  // Load the current configuration's preview on mount so the admin sees a baseline
  // before any chat happens. Effect re-runs only if the productId changes (won't in practice).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/anchor-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId, action: 'preview', strategy: initialStrategy, patterns: initialPatterns }),
        });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (!cancelled) setPreview(json.players ?? []);
      } catch {
        /* non-fatal */
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  async function send() {
    const text = input.trim();
    if (!text || pending) return;
    setError(null);
    setSaved(false);
    const next: ChatMsg[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setPending(true);
    try {
      const res = await fetch('/api/admin/anchor-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, action: 'propose', messages: next }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? `HTTP ${res.status}`);
        return;
      }
      const newProposal: Proposal = json.proposal;
      setProposal(newProposal);
      setPreview(json.preview?.players ?? []);
      const reply = newProposal.rationale || formatProposalSummary(newProposal);
      setMessages([...next, { role: 'assistant', content: reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  async function save() {
    setError(null);
    setPending(true);
    setSaved(false);
    try {
      const res = await fetch('/api/admin/anchor-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          action: 'save',
          strategy: proposal.strategy,
          patterns: proposal.patterns,
          notes: proposal.notes,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? `HTTP ${res.status}`);
        return;
      }
      setPreview(json.players ?? []);
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  function manualPatternEdit(index: number, value: string) {
    setSaved(false);
    setProposal(p => ({ ...p, patterns: p.patterns.map((x, i) => (i === index ? value : x)) }));
  }
  function addPattern() {
    setSaved(false);
    setProposal(p => ({ ...p, patterns: [...p.patterns, ''] }));
  }
  function removePattern(index: number) {
    setSaved(false);
    setProposal(p => ({ ...p, patterns: p.patterns.filter((_, i) => i !== index) }));
  }
  function setStrategy(s: AnchorStrategy) {
    setSaved(false);
    setProposal(p => ({ ...p, strategy: s }));
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-3 space-y-6">
        <Section title="Conversation">
          <div className="space-y-3 mb-4 min-h-32 max-h-96 overflow-y-auto">
            {messages.length === 0 && (
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                Describe how slot prices should anchor for <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{productName}</span>. E.g.{' '}
                <em>&quot;For Bowman Sapphire, anchor on base autos and gold /50 autos. Anything rarer has thin comps.&quot;</em>
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className="rounded-lg p-3 text-sm whitespace-pre-wrap"
                style={{
                  backgroundColor: m.role === 'user' ? 'var(--terminal-surface-hover)' : 'var(--terminal-surface)',
                  border: m.role === 'assistant' ? '1px solid var(--terminal-border)' : undefined,
                  color: 'var(--text-primary)',
                }}
              >
                <div className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--text-tertiary)' }}>
                  {m.role === 'user' ? 'You' : 'Claude'}
                </div>
                {m.content}
              </div>
            ))}
            {pending && (
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>thinking…</p>
            )}
          </div>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
            rows={4}
            placeholder="Describe how to anchor this product. ⌘+Enter to send."
            className="w-full rounded border p-3 text-sm"
            style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface-hover)', color: 'var(--text-primary)' }}
          />
          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={() => void send()}
              disabled={pending || !input.trim()}
              className="rounded border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
            >
              Propose
            </button>
            {error && <span className="text-xs text-red-500">{error}</span>}
          </div>
        </Section>

        {anchorConcepts.length > 0 && (
          <Section title={`${descriptorName} Anchor Concepts`} subtitle="Vocabulary Claude can reason about for this manufacturer family">
            <ul className="text-sm space-y-2">
              {anchorConcepts.map(c => (
                <li key={c.name} className="flex gap-3">
                  <span className="font-mono text-xs whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{c.name}</span>
                  <span style={{ color: 'var(--text-tertiary)' }}>— ex: &quot;{c.example}&quot;{c.description ? ` — ${c.description}` : ''}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>

      <div className="lg:col-span-2 space-y-6">
        <Section title="Proposed Configuration">
          <div className="space-y-3">
            <div>
              <div className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--text-tertiary)' }}>Strategy</div>
              <select
                value={proposal.strategy}
                onChange={e => setStrategy(e.target.value as AnchorStrategy)}
                className="w-full rounded border p-2 text-sm"
                style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface-hover)', color: 'var(--text-primary)' }}
              >
                <option value="sets_weighted_all">sets_weighted_all (default — count every variant)</option>
                <option value="curated_variants">curated_variants (only count matching patterns)</option>
                <option value="curated_with_tail">curated_with_tail (curated + 15% tail bonus)</option>
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Patterns</div>
                <button onClick={addPattern} className="text-xs hover:underline" style={{ color: 'var(--text-secondary)' }}>+ add</button>
              </div>
              {proposal.patterns.length === 0 && (
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>(none)</p>
              )}
              <div className="space-y-2">
                {proposal.patterns.map((p, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      value={p}
                      onChange={e => manualPatternEdit(i, e.target.value)}
                      className="flex-1 rounded border p-2 text-xs font-mono"
                      style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface-hover)', color: 'var(--text-primary)' }}
                    />
                    <button
                      onClick={() => removePattern(i)}
                      className="rounded border px-2 text-xs"
                      style={{ borderColor: 'var(--terminal-border)', color: 'var(--text-tertiary)' }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--text-tertiary)' }}>Notes</div>
              <textarea
                value={proposal.notes}
                onChange={e => setProposal(p => ({ ...p, notes: e.target.value }))}
                rows={3}
                className="w-full rounded border p-2 text-xs"
                style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface-hover)', color: 'var(--text-primary)' }}
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => void save()}
                disabled={pending}
                className="rounded border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
              >
                Save & Publish
              </button>
              {saved && <span className="text-xs" style={{ color: 'var(--success, #10b981)' }}>Saved · applies on next refresh</span>}
            </div>
          </div>
        </Section>

        <Section title="Preview · Top 5 Players" subtitle="Current cached EV vs. proposed EV using cached variant prices (no CH calls)">
          {preview.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              No preview yet. Iterate above, or refresh pricing first if no cached data exists.
            </p>
          )}
          <ul className="text-sm space-y-2">
            {preview.map(p => {
              const current = Math.round(p.currentEvMid);
              const proposed = Math.round(p.proposedEvMid);
              const delta = proposed - current;
              const pct = current > 0 ? (delta / current) * 100 : 0;
              const sign = delta >= 0 ? '+' : '';
              const color = delta > 0 ? 'var(--success, #10b981)' : delta < 0 ? 'var(--danger, #ef4444)' : 'var(--text-tertiary)';
              return (
                <li key={p.playerProductId} className="flex items-center justify-between gap-3">
                  <span className="truncate" style={{ color: 'var(--text-primary)' }}>{p.playerName ?? '—'}</span>
                  {p.nonHydrated ? (
                    <>
                      <span className="font-mono text-xs whitespace-nowrap" style={{ color: 'var(--text-tertiary)' }}>
                        ${current}
                      </span>
                      <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-tertiary)' }}>
                        non-hydrated · fallback pricing
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="font-mono text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                        ${current} → ${proposed}
                      </span>
                      <span className="font-mono text-xs whitespace-nowrap" style={{ color }}>
                        {sign}${Math.abs(delta)} ({sign}{pct.toFixed(0)}%)
                      </span>
                      {p.proposedFellBack && (
                        <span className="text-xs" style={{ color: 'var(--warning, #f59e0b)' }}>fellback</span>
                      )}
                      <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        {p.proposedMatched} var
                      </span>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
    >
      <div className="h-1" style={{ background: 'var(--accent, #60a5fa)' }} />
      <div className="p-5">
        <h2 className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-tertiary)' }}>{title}</h2>
        {subtitle && <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

function formatProposalSummary(p: Proposal): string {
  return `Strategy: ${p.strategy}\nPatterns: ${p.patterns.length === 0 ? '(none)' : p.patterns.join(', ')}\n\n${p.notes}`;
}
