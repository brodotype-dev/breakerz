// Drive match-cardhedger (cron-bearer) to re-run matching on a product's
// unmatched variants. Multi-pass: repeats until unmatched stops shrinking
// (the route's IS-NULL window shifts as matches land, so one pass skips some).
// Usage: node scripts/drive-rematch.mjs <productId>
import fs from 'node:fs';
const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')]; })
);
const SECRET = env.CRON_SECRET;
const BASE = (env.NEXT_PUBLIC_APP_URL || 'https://www.getbreakiq.com').replace(/\/$/,'').replace('://getbreakiq.com','://www.getbreakiq.com');
const productId = process.argv[2];
if (!productId) { console.error('usage: drive-rematch.mjs <productId>'); process.exit(1); }

async function pass() {
  let offset = 0, auto = 0, review = 0, total = 0;
  while (true) {
    const res = await fetch(`${BASE}/api/admin/match-cardhedger`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ productId, offset }),
    });
    if (!res.ok) { console.error(`\nHTTP ${res.status}: ${(await res.text()).slice(0,200)}`); process.exit(1); }
    const j = await res.json();
    total = j.total ?? total;
    auto += (j.results ?? []).filter(r => r.status === 'auto').length;
    review += (j.results ?? []).filter(r => r.status === 'review').length;
    offset += j.processed ?? (j.results ?? []).length;
    if (!j.hasMore) break;
  }
  return { auto, review, startTotal: total };
}

const t0 = Date.now();
let prevRemaining = Infinity, passNo = 0, grandAuto = 0;
while (passNo < 8) {
  passNo++;
  const r = await pass();
  grandAuto += r.auto;
  // remaining = startTotal of NEXT pass; cheap to re-derive: the route's `total`
  // at offset 0 reflects current unmatched. Do a 1-call probe.
  const probe = await fetch(`${BASE}/api/admin/match-cardhedger`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
    body: JSON.stringify({ productId, offset: 0, limit: 1 }),
  }).then(x => x.json());
  const remaining = probe.total ?? 0;
  console.log(`pass ${passNo}: auto+${r.auto} review+${r.review} → remaining ${remaining}`);
  if (remaining >= prevRemaining || remaining === 0) break;
  prevRemaining = remaining;
}
console.log(`done in ${Math.round((Date.now()-t0)/1000)}s — total auto matched ${grandAuto}`);
