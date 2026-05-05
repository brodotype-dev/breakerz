'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'breakiq:install-dismissed';

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  // iOS Safari doesn't fire `beforeinstallprompt`, so we detect the platform
  // up-front and show a manual "Add to Home Screen" hint instead.
  const [showIosHint] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const ua = window.navigator.userAgent;
    return /iPhone|iPad|iPod/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  });
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    if (localStorage.getItem(DISMISS_KEY) !== null) return true;
    // Already running standalone — no prompt needed.
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // @ts-expect-error iOS Safari
      window.navigator.standalone === true;
    return standalone;
  });

  useEffect(() => {
    if (dismissed) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, [dismissed]);

  if (dismissed) return null;
  if (!deferred && !showIosHint) return null;

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  const handleInstall = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    setDismissed(true);
    localStorage.setItem(DISMISS_KEY, '1');
  };

  return (
    <div className="fixed bottom-3 left-3 right-3 sm:left-auto sm:right-4 sm:bottom-4 sm:max-w-sm z-50 rounded-lg border bg-card p-3 shadow-lg flex items-start gap-3"
      style={{ borderColor: 'var(--terminal-border)' }}
    >
      <div className="w-9 h-9 shrink-0 rounded-md bg-gradient-to-br from-blue-500 to-purple-500" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground">Install BreakIQ</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {deferred
            ? 'Add to your homescreen for one-tap access during breaks.'
            : 'Tap Share, then "Add to Home Screen" to install.'}
        </p>
        {deferred && (
          <button
            type="button"
            onClick={handleInstall}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            <Download className="w-3 h-3" />
            Install
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss install prompt"
        className="shrink-0 p-1 text-muted-foreground hover:text-foreground"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
