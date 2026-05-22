'use client';

import React, { useState } from 'react';

type WaitlistEntry = {
  id: string;
  email: string;
  full_name: string | null;
  use_case: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'converted';
  invite_code: string | null;
  invite_sent_at: string | null;
  created_at: string;
};

type Tab = 'pending' | 'approved' | 'converted' | 'rejected';

const STATUS_COLORS: Record<string, string> = {
  pending:   'var(--signal-watch)',
  approved:  'var(--accent-blue)',
  converted: 'var(--signal-buy)',
  rejected:  'var(--text-disabled)',
};

export default function WaitlistTable({ entries }: { entries: WaitlistEntry[] }) {
  const [tab, setTab] = useState<Tab>('pending');
  const [approving, setApproving] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [localEntries, setLocalEntries] = useState(entries);
  // Per-row sticky error state. Banner stays visible after page-render until
  // the row scrolls off the active tab — alert() popups were dismissable and
  // would have hidden the 2026-04→2026-05 silent failures even if we'd been
  // surfacing them. This pattern keeps the error in front of the admin.
  const [emailErrors, setEmailErrors] = useState<Record<string, string>>({});

  const tabs: Tab[] = ['pending', 'approved', 'converted', 'rejected'];
  const filtered = localEntries.filter(e => e.status === tab);

  async function handleApprove(id: string) {
    setApproving(id);
    const res = await fetch(`/api/admin/waitlist/${id}/approve`, { method: 'POST' });
    if (res.ok) {
      const { emailDelivered, emailError } = await res.json();
      setLocalEntries(prev =>
        prev.map(e => e.id === id
          ? { ...e, status: 'approved', invite_sent_at: new Date().toISOString() }
          : e
        )
      );
      if (emailDelivered === false) {
        setEmailErrors(prev => ({
          ...prev,
          [id]: emailError ?? 'Unknown email error',
        }));
      }
    } else {
      const { error } = await res.json();
      alert(`Failed to approve: ${error}`);
    }
    setApproving(null);
  }

  async function handleReject(id: string, email: string) {
    if (!confirm(`Reject "${email}"? They'll move to the Rejected tab (kept for audit).`)) return;
    setRejecting(id);
    const res = await fetch(`/api/admin/waitlist/${id}/reject`, { method: 'POST' });
    if (res.ok) {
      setLocalEntries(prev => prev.map(e => (e.id === id ? { ...e, status: 'rejected' } : e)));
    } else {
      const { error } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      alert(`Failed to reject: ${error}`);
    }
    setRejecting(null);
  }

  async function handleDelete(id: string, email: string) {
    if (!confirm(`Permanently delete "${email}"? This removes the waitlist row entirely (no audit trail).`)) return;
    setDeleting(id);
    const res = await fetch(`/api/admin/waitlist/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setLocalEntries(prev => prev.filter(e => e.id !== id));
    } else {
      const { error } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      alert(`Failed to delete: ${error}`);
    }
    setDeleting(null);
  }

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
    >
      {/* Tabs */}
      <div className="flex border-b" style={{ borderColor: 'var(--terminal-border)' }}>
        {tabs.map(t => {
          const count = localEntries.filter(e => e.status === t).length;
          const active = tab === t;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-4 py-3 text-xs font-bold uppercase tracking-wider transition-colors"
              style={{
                color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                borderBottom: active ? '2px solid var(--accent-blue)' : '2px solid transparent',
                backgroundColor: active ? 'var(--terminal-surface-hover)' : 'transparent',
              }}
            >
              {t} ({count})
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="p-8 text-center text-sm" style={{ color: 'var(--text-tertiary)' }}>
          No {tab} entries.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr style={{ backgroundColor: 'var(--terminal-surface-hover)', color: 'var(--text-tertiary)' }}>
              <th className="text-left px-4 py-2.5 text-xs font-bold uppercase tracking-wider">Name / Email</th>
              <th className="text-left px-4 py-2.5 text-xs font-bold uppercase tracking-wider">Use Case</th>
              <th className="text-left px-4 py-2.5 text-xs font-bold uppercase tracking-wider">Joined</th>
              <th className="text-left px-4 py-2.5 text-xs font-bold uppercase tracking-wider">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: 'var(--terminal-border)' }}>
            {filtered.map(entry => {
              const colSpan = 5;
              const emailErr = emailErrors[entry.id];
              return (
                <React.Fragment key={entry.id}>
                  <tr style={{ color: 'var(--text-secondary)' }}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                        {entry.full_name ?? '—'}
                      </p>
                      <p className="text-xs font-mono">{entry.email}</p>
                    </td>
                    <td className="px-4 py-3 text-xs max-w-[200px]">
                      <span style={{ color: 'var(--text-tertiary)' }}>
                        {entry.use_case ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs font-mono">
                      {new Date(entry.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-bold uppercase" style={{ color: STATUS_COLORS[entry.status] }}>
                        {entry.status}
                      </span>
                      {entry.invite_sent_at && (
                        <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-disabled)' }}>
                          Sent {new Date(entry.invite_sent_at).toLocaleDateString()}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        {tab === 'pending' && (
                          <>
                            <button
                              onClick={() => handleApprove(entry.id)}
                              disabled={approving === entry.id || rejecting === entry.id || deleting === entry.id}
                              className="text-xs font-bold px-3 py-1.5 rounded-lg transition-all disabled:opacity-50"
                              style={{
                                backgroundColor: 'rgba(59,130,246,0.15)',
                                color: 'var(--accent-blue)',
                                border: '1px solid rgba(59,130,246,0.3)',
                              }}
                            >
                              {approving === entry.id ? 'Sending…' : 'Approve + Invite →'}
                            </button>
                            <button
                              onClick={() => handleReject(entry.id, entry.email)}
                              disabled={approving === entry.id || rejecting === entry.id || deleting === entry.id}
                              className="text-xs font-bold px-3 py-1.5 rounded-lg transition-all disabled:opacity-50 hover:bg-[var(--terminal-surface-hover)]"
                              style={{
                                border: '1px solid var(--terminal-border)',
                                color: 'var(--text-secondary)',
                              }}
                            >
                              {rejecting === entry.id ? 'Rejecting…' : 'Reject'}
                            </button>
                          </>
                        )}
                        {entry.status !== 'converted' && (
                          <button
                            onClick={() => handleDelete(entry.id, entry.email)}
                            disabled={approving === entry.id || rejecting === entry.id || deleting === entry.id}
                            className="text-xs font-bold px-3 py-1.5 rounded-lg transition-all disabled:opacity-50"
                            style={{
                              backgroundColor: 'rgba(239,68,68,0.10)',
                              color: '#fca5a5',
                              border: '1px solid rgba(239,68,68,0.35)',
                            }}
                            title="Permanently delete this row"
                          >
                            {deleting === entry.id ? 'Deleting…' : 'Delete'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {emailErr && (
                    <tr>
                      <td colSpan={colSpan} className="px-4 pb-3">
                        <div
                          className="rounded-lg px-3 py-2 text-xs"
                          style={{
                            backgroundColor: 'rgba(239,68,68,0.10)',
                            border: '1px solid rgba(239,68,68,0.35)',
                            color: '#fecaca',
                          }}
                        >
                          <strong style={{ color: '#fca5a5' }}>Invite email failed to send.</strong>{' '}
                          Approval saved with a valid invite code — check Resend logs or resend manually.
                          <span className="font-mono" style={{ color: '#fca5a5', marginLeft: 6 }}>
                            {emailErr}
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
