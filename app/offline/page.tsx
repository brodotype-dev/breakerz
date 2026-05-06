import Link from 'next/link';

export const metadata = {
  title: 'Offline — BreakIQ',
  description: 'BreakIQ needs a connection to load live break data.',
};

export const dynamic = 'force-static';

export default function OfflinePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
      <div className="max-w-sm w-full text-center space-y-4">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-500" />
        <h1 className="text-xl font-semibold">You&apos;re offline</h1>
        <p className="text-sm text-muted-foreground">
          BreakIQ needs a connection to pull live pricing and break data. Reconnect and try again.
        </p>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Retry
        </Link>
      </div>
    </div>
  );
}
