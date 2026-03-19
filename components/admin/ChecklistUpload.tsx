'use client';

import Link from 'next/link';

type Props = {
  productId: string;
  sportId: string;
  productName: string;
};

export default function ChecklistUpload({ productId }: Props) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        Import from Checklist
      </h3>
      <p className="text-sm text-muted-foreground">
        Use the import wizard to upload a PDF or CSV checklist, review sections,
        and run CardHedger matching in one flow.
      </p>
      <Link
        href={`/admin/import-checklist?productId=${productId}`}
        className="inline-block rounded bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Open Import Wizard →
      </Link>
    </div>
  );
}
