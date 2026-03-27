'use client';

export default function Error({ error }: { error: Error & { digest?: string } }) {
  return (
    <div className="p-8">
      <h2 className="text-xl font-bold text-destructive mb-2">Page error</h2>
      <pre className="text-sm bg-card border rounded p-4 overflow-auto" style={{ borderColor: 'var(--border)' }}>
        {error.message}
        {'\n\n'}
        {error.stack}
      </pre>
    </div>
  );
}
