// Editorial-content scraper — Slice 3 (Bucket A).
//
// Fetches the readable text of an arbitrary editorial / content URL
// (Beckett product news, Topps blog, break-preview pages, forum threads,
// etc.) as markdown. Unlike the structured scrapers (waxstat, mlb-pipeline)
// this one is content-AGNOSTIC: we don't know the page shape, so we pull
// markdown and let Claude infer meaning downstream (see lib/editorial-parser.ts).
//
// Firecrawl pattern per lib/waxstat.ts: lazy singleton, no plain-fetch
// fallback (many sources are Cloudflare-protected), throw on empty so the
// importer can record a per-URL error.

let _fcClient: import('@mendable/firecrawl-js').FirecrawlClient | null = null;
async function getFirecrawl() {
  if (_fcClient) return _fcClient;
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error('FIRECRAWL_API_KEY is not configured');
  const { FirecrawlClient } = await import('@mendable/firecrawl-js');
  _fcClient = new FirecrawlClient({ apiKey });
  return _fcClient;
}

export interface EditorialPage {
  url: string;
  /** Page title when Firecrawl surfaces one (metadata.title). */
  title: string | null;
  /** Main-content markdown, trimmed + capped to keep the Claude call cheap. */
  markdown: string;
}

// Cap the markdown we hand to Claude — editorial pages can be long, and the
// signal (hype/sentiment) is almost always in the lede + body, not the
// footer/comments. ~12k chars ≈ 3k tokens, plenty for a product writeup.
const MARKDOWN_CHAR_CAP = 12_000;

export async function scrapeEditorial(url: string): Promise<EditorialPage> {
  const fc = await getFirecrawl();

  const result = await fc.scrape(url, {
    formats: ['markdown'],
    onlyMainContent: true,
    waitFor: 4000,
    timeout: 60_000,
  });

  const markdown = (result as { markdown?: string }).markdown ?? '';
  const trimmed = markdown.trim();
  if (!trimmed) {
    throw new Error('Firecrawl returned no readable content for this URL');
  }

  // metadata.title is best-effort across the SDK's response shapes.
  const meta = (result as { metadata?: { title?: string } }).metadata;
  const title = meta?.title?.trim() || null;

  return {
    url,
    title,
    markdown: trimmed.slice(0, MARKDOWN_CHAR_CAP),
  };
}
