import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { searchCards, getAllPrices, getComps } from '@/lib/cardhedger';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: Request) {
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

  // ── Mode 2: Price lookup via CardHedger ───────────────────────
  if (body.action === 'price') {
    const { playerName, setName, year, cardNumber, variant, gradingCompany, grade } = body as {
      playerName: string;
      setName: string;
      year: string;
      cardNumber: string;
      variant: string;
      gradingCompany: string;
      grade: string;
    };

    if (!playerName) {
      return NextResponse.json({ error: 'playerName required' }, { status: 400 });
    }

    // Build search query — player + year + set are the most useful signals
    const queryParts = [playerName, year, setName, cardNumber, variant].filter(Boolean);
    const query = queryParts.join(' ');

    const searchResult = await searchCards(query);
    const card = searchResult.cards?.[0];
    if (!card) {
      return NextResponse.json({ error: 'No matching card found in CardHedger' }, { status: 404 });
    }

    // Grade string for the comps endpoint e.g. "PSA 10", "BGS 9.5", "Raw"
    const gradeString = gradingCompany && grade ? `${gradingCompany} ${grade}` : 'Raw';

    const [pricesResult, compsResult] = await Promise.allSettled([
      getAllPrices(card.card_id),
      getComps(card.card_id, 90, gradeString, 20),
    ]);

    const prices = pricesResult.status === 'fulfilled' ? pricesResult.value.prices : [];
    const comps  = compsResult.status  === 'fulfilled' ? compsResult.value.comps   : [];

    // Find the price entry that best matches the requested grade
    const gradeKey = grade ? grade.toString() : '';
    const matchedPrice = prices.find(p =>
      p.grade.toLowerCase().includes(gradeKey.toLowerCase()) &&
      (gradingCompany ? p.grade.toLowerCase().includes(gradingCompany.toLowerCase()) : true)
    ) ?? prices.find(p => p.grade.toLowerCase().includes('raw')) ?? prices[0] ?? null;

    return NextResponse.json({
      card: {
        card_id: card.card_id,
        player_name: card.player_name,
        set_name: card.set_name,
        year: card.year,
        number: card.number,
        variant: card.variant,
        rookie: card.rookie,
      },
      prices,
      comps,
      matchedGrade: gradeString,
      matchedPrice: matchedPrice ? { grade: matchedPrice.grade, price: parseFloat(String(matchedPrice.price)) } : null,
    });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
