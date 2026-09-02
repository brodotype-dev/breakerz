'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { User, Calendar, Heart, Save, CheckCircle, FileText, AlertTriangle, Users } from 'lucide-react';
import { TERMS_VERSION, PRIVACY_VERSION, TERMS_PATH, PRIVACY_PATH, isCurrent } from '@/lib/legal';
import { DiscordIcon } from '@/components/icons/DiscordIcon';
import { DISCORD_INVITE_URL, isDiscordInviteConfigured } from '@/lib/community';

interface ProfileData {
  first_name: string;
  last_name: string;
  is_over_18: boolean | null;
  favorite_sports: string[];
  chasing_teams: string[];
  chasing_players: string[];
  terms_accepted_at: string | null;
  terms_version: string | null;
  privacy_accepted_at: string | null;
  privacy_version: string | null;
}

const EMPTY: ProfileData = {
  first_name: '',
  last_name: '',
  is_over_18: null,
  favorite_sports: [],
  chasing_teams: [],
  chasing_players: [],
  terms_accepted_at: null,
  terms_version: null,
  privacy_accepted_at: null,
  privacy_version: null,
};

function toCSV(arr: string[]) {
  return arr.join(', ');
}

function fromCSV(val: string): string[] {
  return val
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function computeIsOver18(dob: string): boolean {
  if (!dob) return false;
  const birth = new Date(dob);
  const now = new Date();
  const age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) return age - 1 >= 18;
  return age >= 18;
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<ProfileData>(EMPTY);
  const [dob, setDob] = useState('');

  // CSV buffer for array fields
  const [sportsInput, setSportsInput] = useState('');
  const [teamsInput, setTeamsInput] = useState('');
  const [playersInput, setPlayersInput] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/profile')
      .then(async r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(({ profile: p }) => {
        if (p) {
          setProfile(p);
          setSportsInput(toCSV(p.favorite_sports ?? []));
          setTeamsInput(toCSV(p.chasing_teams ?? []));
          setPlayersInput(toCSV(p.chasing_players ?? []));
        }
      })
      .catch(() => setError('Could not load your profile. Refresh to try again.'))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);

    const payload: ProfileData = {
      ...profile,
      favorite_sports: fromCSV(sportsInput),
      chasing_teams: fromCSV(teamsInput),
      chasing_players: fromCSV(playersInput),
      is_over_18: dob ? computeIsOver18(dob) : profile.is_over_18,
    };

    const res = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      setProfile(payload);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } else {
      const { error: e } = await res.json();
      setError(e ?? 'Something went wrong');
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--terminal-bg)' }}>
        <div
          className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
          style={{ borderColor: 'var(--accent-blue)', borderTopColor: 'transparent' }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--terminal-bg)' }}>
      {/* Header */}
      <div
        className="border-b px-6 py-6"
        style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
      >
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-1">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'var(--gradient-blue)' }}
            >
              <User className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>My Profile</h1>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Your info and hobby preferences
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="px-6 py-8 max-w-2xl mx-auto space-y-6">

        {/* Identity */}
        <section
          className="rounded-xl border p-6"
          style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
        >
          <div className="flex items-center gap-2 mb-5">
            <User className="w-4 h-4" style={{ color: 'var(--accent-blue)' }} />
            <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              Identity
            </h2>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                First Name
              </label>
              <input
                type="text"
                value={profile.first_name ?? ''}
                onChange={e => setProfile(p => ({ ...p, first_name: e.target.value }))}
                placeholder="First name"
                className="w-full h-10 rounded-lg border px-3 text-sm focus:outline-none transition-colors"
                style={{
                  backgroundColor: 'var(--terminal-bg)',
                  borderColor: 'var(--terminal-border)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Last Name
              </label>
              <input
                type="text"
                value={profile.last_name ?? ''}
                onChange={e => setProfile(p => ({ ...p, last_name: e.target.value }))}
                placeholder="Last name"
                className="w-full h-10 rounded-lg border px-3 text-sm focus:outline-none transition-colors"
                style={{
                  backgroundColor: 'var(--terminal-bg)',
                  borderColor: 'var(--terminal-border)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              <span className="flex items-center gap-1.5">
                <Calendar className="w-3 h-3" />
                Date of Birth
                <span style={{ color: 'var(--text-tertiary)' }}>— used for age verification only, not stored</span>
              </span>
            </label>
            <div className="flex items-center gap-3">
              <input
                type="date"
                value={dob}
                onChange={e => setDob(e.target.value)}
                className="h-10 rounded-lg border px-3 text-sm focus:outline-none transition-colors"
                style={{
                  backgroundColor: 'var(--terminal-bg)',
                  borderColor: 'var(--terminal-border)',
                  color: dob ? 'var(--text-primary)' : 'var(--text-tertiary)',
                }}
              />
              {profile.is_over_18 !== null && !dob && (
                <span
                  className="text-xs font-medium px-2.5 py-1 rounded-full"
                  style={{
                    backgroundColor: profile.is_over_18 ? 'var(--signal-buy-bg)' : 'rgba(239,68,68,0.1)',
                    color: profile.is_over_18 ? 'var(--signal-buy)' : 'var(--signal-pass)',
                  }}
                >
                  {profile.is_over_18 ? '18+ verified' : 'Under 18'}
                </span>
              )}
              {dob && (
                <span
                  className="text-xs font-medium px-2.5 py-1 rounded-full"
                  style={{
                    backgroundColor: computeIsOver18(dob) ? 'var(--signal-buy-bg)' : 'rgba(239,68,68,0.1)',
                    color: computeIsOver18(dob) ? 'var(--signal-buy)' : 'var(--signal-pass)',
                  }}
                >
                  {computeIsOver18(dob) ? '18+' : 'Under 18'}
                </span>
              )}
            </div>
          </div>
        </section>

        {/* Hobby Preferences */}
        <section
          className="rounded-xl border p-6"
          style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Heart className="w-4 h-4" style={{ color: 'var(--accent-blue)' }} />
            <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              Hobby Preferences
            </h2>
          </div>
          <p className="text-xs mb-5" style={{ color: 'var(--text-tertiary)' }}>
            Separate multiple entries with commas. Used to personalize your deal analysis.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Favorite Sports
              </label>
              <input
                type="text"
                value={sportsInput}
                onChange={e => setSportsInput(e.target.value)}
                placeholder="e.g. Baseball, Basketball"
                className="w-full h-10 rounded-lg border px-3 text-sm focus:outline-none"
                style={{
                  backgroundColor: 'var(--terminal-bg)',
                  borderColor: 'var(--terminal-border)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Teams I Chase
              </label>
              <input
                type="text"
                value={teamsInput}
                onChange={e => setTeamsInput(e.target.value)}
                placeholder="e.g. Yankees, Lakers, Cowboys"
                className="w-full h-10 rounded-lg border px-3 text-sm focus:outline-none"
                style={{
                  backgroundColor: 'var(--terminal-bg)',
                  borderColor: 'var(--terminal-border)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Players I Follow
              </label>
              <input
                type="text"
                value={playersInput}
                onChange={e => setPlayersInput(e.target.value)}
                placeholder="e.g. Paul Skenes, Victor Wembanyama"
                className="w-full h-10 rounded-lg border px-3 text-sm focus:outline-none"
                style={{
                  backgroundColor: 'var(--terminal-bg)',
                  borderColor: 'var(--terminal-border)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>
          </div>
        </section>

        {/* Legal Acceptance — read-only audit trail */}
        <section
          className="rounded-xl border p-6"
          style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
        >
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-4 h-4" style={{ color: 'var(--accent-blue)' }} />
            <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              Legal
            </h2>
          </div>
          <p className="text-xs mb-5" style={{ color: 'var(--text-tertiary)' }}>
            Record of when you accepted our policies. Read the latest versions any time.
          </p>

          <div className="space-y-3">
            <LegalAcceptanceRow
              label="Terms & Conditions"
              href={TERMS_PATH}
              acceptedAt={profile.terms_accepted_at}
              acceptedVersion={profile.terms_version}
              currentVersion={TERMS_VERSION}
            />
            <LegalAcceptanceRow
              label="Privacy Policy"
              href={PRIVACY_PATH}
              acceptedAt={profile.privacy_accepted_at}
              acceptedVersion={profile.privacy_version}
              currentVersion={PRIVACY_VERSION}
            />
          </div>
        </section>

        {/* Community — small Discord CTA. Hidden if DISCORD_INVITE_URL
            isn't configured yet so we never ship a dead link. */}
        {isDiscordInviteConfigured() && (
          <section
            className="rounded-xl border p-5"
            style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
          >
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />
              <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                Community
              </h2>
            </div>
            <a
              href={DISCORD_INVITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3 transition-colors hover:bg-[var(--terminal-bg)]"
              style={{ borderColor: 'var(--terminal-border)' }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <DiscordIcon className="text-[#5865F2] shrink-0" size={24} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Join the BreakIQ Discord
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                    Chat with other beta users, share pulls, and shape what we build next.
                  </p>
                </div>
              </div>
              <span className="text-xs font-bold uppercase tracking-wide shrink-0" style={{ color: 'var(--accent-blue)' }}>
                Join →
              </span>
            </a>
          </section>
        )}

        {/* Save */}
        {error && (
          <p className="text-sm" style={{ color: 'var(--signal-pass)' }}>{error}</p>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full h-11 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50"
          style={{ background: 'var(--gradient-blue)', color: 'white', boxShadow: saved ? 'none' : 'var(--glow-blue)' }}
        >
          {saved ? (
            <>
              <CheckCircle className="w-4 h-4" />
              Saved
            </>
          ) : saving ? (
            'Saving…'
          ) : (
            <>
              <Save className="w-4 h-4" />
              Save Profile
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function LegalAcceptanceRow({
  label,
  href,
  acceptedAt,
  acceptedVersion,
  currentVersion,
}: {
  label: string;
  href: string;
  acceptedAt: string | null;
  acceptedVersion: string | null;
  currentVersion: string;
}) {
  const accepted = !!acceptedAt;
  const upToDate = isCurrent(acceptedVersion, currentVersion);
  const formatted = acceptedAt
    ? new Date(acceptedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : null;

  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
      style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-bg)' }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Link
            href={href}
            target="_blank"
            rel="noopener"
            className="text-sm font-semibold hover:underline"
            style={{ color: 'var(--text-primary)' }}
          >
            {label}
          </Link>
          {accepted && upToDate && (
            <span
              className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
              style={{ backgroundColor: 'var(--signal-buy-bg)', color: 'var(--signal-buy)' }}
            >
              Accepted
            </span>
          )}
          {accepted && !upToDate && (
            <span
              className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded inline-flex items-center gap-1"
              style={{ backgroundColor: 'rgba(234,179,8,0.12)', color: 'var(--signal-watch)' }}
            >
              <AlertTriangle className="w-3 h-3" />
              Update available
            </span>
          )}
          {!accepted && (
            <span
              className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
              style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: 'var(--signal-pass)' }}
            >
              Not accepted
            </span>
          )}
        </div>
        <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
          {accepted
            ? <>Accepted {formatted} · version {acceptedVersion}{upToDate ? '' : ` · current ${currentVersion}`}</>
            : <>You haven&apos;t accepted this version yet.</>}
        </p>
      </div>
    </div>
  );
}
