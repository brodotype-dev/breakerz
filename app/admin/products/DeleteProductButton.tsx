'use client';

import { useState } from 'react';
import { deleteProduct } from './actions';

export default function DeleteProductButton({ productId, productName }: { productId: string; productName: string }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  if (confirming) {
    return (
      <span className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Delete &ldquo;{productName}&rdquo;?</span>
        <button
          onClick={async () => {
            setLoading(true);
            await deleteProduct(productId);
          }}
          disabled={loading}
          className="text-[color:var(--signal-pass)] hover:text-[color:var(--signal-pass)] font-medium disabled:opacity-50"
        >
          {loading ? 'Deleting…' : 'Yes'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="text-xs text-muted-foreground hover:text-[color:var(--signal-pass)] transition-colors"
    >
      Delete
    </button>
  );
}
