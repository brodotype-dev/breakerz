'use client';

import { ArrowLeft } from 'lucide-react';

// Goes back in history if there is one, otherwise sends the user home.
// Used in the legal layout so users entering from /profile (or anywhere)
// have a one-tap escape — the prior layout only offered the BreakIQ logo
// link to /, which left users stranded inside the installed PWA.
export default function BackButton() {
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window === 'undefined') return;
        if (window.history.length > 1) {
          window.history.back();
        } else {
          window.location.href = '/';
        }
      }}
      className="inline-flex items-center gap-1.5 text-xs font-medium hover:underline"
      style={{ color: 'var(--text-secondary)' }}
    >
      <ArrowLeft className="w-3.5 h-3.5" />
      Back
    </button>
  );
}
