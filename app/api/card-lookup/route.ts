import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { pricesByCert, searchCards, getAllPrices, getComps } from '@/lib/cardhedger';
import { getCertByNumber } from '@/lib/psa';

export async function POST(req: Request) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const body = await req.json();

    // ── Mode 1: Parse a screenshot with Claude vision ──────────────
    if (body.action === 'parse') {
      const { imageBase64, mediaType } = body as {
        imageBase64: string;
        mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
      };

      if (!imageBase64) {
        return NextResponse.json({ error: 'imageBase64 required' }, { status: 400 });
      }

      const message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType ?? 'image/jpeg',
                data: imageBase64,
              },
            },
            {
              type: 'text',
              text: `Extract sports card details from this auction or marketplace listing screenshot.

Return JSON only — no explanation, no markdown:
{
  "playerName": "player full name",
  "setName": "card set or product name",
  "year": "card year as 4-digit string",
  "cardNumber": "card number if visible, else empty string",
  "variant": "parallel or insert variant name if any, empty string if base card",
  "gradingCompany": "PSA, BGS, SGC, or empty string if raw/ungraded",
  "grade": "numeric grade e.g. 10, 9.5, 9, empty string if ungraded",
  "certNumber": "PSA/BGS/SGC certification number if visible, else empty string"
}

Use empty strings for any field not visible or not applicable.`,
            },
          ],
        }],
      });

      const raw = (message.content[0] as { type: string; text: string }).text.trim();
      const json = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      const parsed = JSON.parse(json);
      return NextResponse.json(parsed);
    }

    // ── Mode 2a: Cert lookup ─────────────────────────────────────────
    if (body.action === 'cert') {
      const { cert, grader } = body as { cert: string; grader?: string };
      if (!cert) return NextResponse.json({ error: 'cert required' }, { status: 400 });

      const certTrimmed = cert.trim();
      const isPSA = !grader || grader.toUpperCase() === 'PSA';

      // Run PSA lookup and CH cert lookup in parallel when it's a PSA cert
      const [psaResult, chResult] = await Promise.allSettled([
        isPSA ? getCertByNumber(certTrimmed) : Promise.reject(new Error('not PSA')),
        pricesByCert(certTrimmed),
      ]);

      const psaCert = psaResult.status === 'fulfilled' ? psaResult.value.PSACert : null;
      const chData = chResult.status === 'fulfilled' ? chResult.value : null;

      // Derive cert identity: prefer PSA (authoritative), fall back to CH
      const certInfo = psaCert
        ? {
            grader: 'PSA',
            cert: certTrimmed,
            grade: psaCert.CardGrade,
            description: psaCert.GradeDescription,
          }
        : (chData?.cert_info ?? { grader: grader ?? '', cert: certTrimmed, grade: '', description: '' });

      // If CH has prices, use them. If not, try a name-based CH search using PSA identity
      // (or CH cert identity if PSA failed but CH returned card info).
      let prices = chData?.prices ?? [];
      let card = chData?.card ?? null;

      if (prices.length === 0) {
        // Prefer PSA identity; fall back to CH cert card info
        const playerName = psaCert?.Subject ?? chData?.card?.player ?? null;
        const year = psaCert?.Year ?? null;
        const brand = psaCert?.Brand ?? chData?.card?.set ?? null;
        const cardNum = psaCert?.CardNumber ?? chData?.card?.number ?? null;
        const variety = psaCert?.Variety ?? chData?.card?.variant ?? null;
        const grade = psaCert?.CardGrade ?? certInfo.grade ?? null;

        if (playerName) {
          const query = [playerName, year, brand, cardNum, variety].filter(Boolean).join(' ');
          try {
            const searchResult = await searchCards(query);
            const found = searchResult.cards?.[0];
            if (found) {
              const foundRaw = found as unknown as Record<string, unknown>;
              card = card ?? {
                card_id: found.card_id,
                description: [year, brand, cardNum].filter(Boolean).join(' '),
                player: playerName,
                set: brand ?? '',
                number: cardNum ?? '',
                variant: variety ?? '',
                image: (foundRaw.image ?? '') as string,
                category: (foundRaw.category ?? psaCert?.Category ?? '') as string,
              };
              const allPricesResult = await getAllPrices(found.card_id);
              const gradeStr = grade ? `PSA ${grade}` : null;
              const matched = gradeStr
                ? (allPricesResult.prices ?? []).find(p => p.grade.toLowerCase().includes(grade!.toLowerCase()))
                : null;
              if (matched) {
                prices = [{ closing_date: new Date().toISOString(), Grade: gradeStr!, card_id: found.card_id, price: String(matched.price) }];
              }
            }
          } catch {
            // Name search failed — return what we have
          }
        }
      }

      const salePrices = prices.map(p => parseFloat(p.price)).filter(p => p > 0);
      const avg = salePrices.length > 0
        ? salePrices.reduce((a, b) => a + b, 0) / salePrices.length
        : null;

      return NextResponse.json({
        source: 'cert',
        psaVerified: psaCert !== null,
        psaCert: psaCert ?? null,
        certInfo,
        card,
        prices,
        lastSale: prices[0] ?? null,
        avgPrice: avg ? Math.round(avg * 100) / 100 : null,
      });
    }

    // ── Mode 2b: Name-based fallback — when cert isn't available ───
    if (body.action === 'price') {
      const { playerName, setName, year, cardNumber, variant, gradingCompany, grade } = body as {
        playerName: string; setName: string; year: string; cardNumber: string;
        variant: string; gradingCompany: string; grade: string;
      };

      if (!playerName) return NextResponse.json({ error: 'playerName required' }, { status: 400 });

      const query = [playerName, year, setName, cardNumber, variant].filter(Boolean).join(' ');
      const searchResult = await searchCards(query);
      const card = searchResult.cards?.[0];
      if (!card) return NextResponse.json({ error: 'No matching card found in CardHedger' }, { status: 404 });

      const searchPrices = (card as unknown as { prices?: Array<{ grade: string; price: string }> }).prices ?? [];

      const gradeString = gradingCompany && grade ? `${gradingCompany} ${grade}` : 'Raw';
      const [pricesResult, compsResult] = await Promise.allSettled([
        getAllPrices(card.card_id),
        getComps(card.card_id, 90, gradeString, 20),
      ]);

      const allPrices = pricesResult.status === 'fulfilled'
        ? (pricesResult.value.prices ?? [])
        : searchPrices;

      const comps = compsResult.status === 'fulfilled'
        ? (compsResult.value.comps ?? [])
        : [];

      const matchedPrice = allPrices.find(p =>
        p.grade.toLowerCase().includes((grade ?? '').toLowerCase()) &&
        (gradingCompany ? p.grade.toLowerCase().includes(gradingCompany.toLowerCase()) : true)
      ) ?? allPrices[0] ?? null;

      const cardRaw = card as unknown as Record<string, unknown>;

      return NextResponse.json({
        source: 'search',
        card: {
          card_id: card.card_id,
          player_name: (cardRaw.player ?? cardRaw.player_name ?? '') as string,
          set_name: (cardRaw.set ?? cardRaw.set_name ?? '') as string,
          year: (cardRaw.year ?? '') as string,
          number: card.number,
          variant: card.variant,
          rookie: card.rookie,
          image: (cardRaw.image ?? '') as string,
        },
        allPrices,
        comps,
        matchedGrade: gradeString,
        matchedPrice: matchedPrice ? { grade: matchedPrice.grade, price: parseFloat(String(matchedPrice.price)) } : null,
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    console.error('[card-lookup]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
