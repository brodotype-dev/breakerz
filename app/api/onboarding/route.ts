import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import type { ExperienceLevel, MonthlySpend, Platform, ReferralSource } from '@/lib/types';

const VALID_EXPERIENCE: ExperienceLevel[] = ['beginner', 'casual', 'regular', 'serious'];
const VALID_SPEND: MonthlySpend[] = ['under_150', '150_500', '500_1000', '1000_5000', '5000_plus'];
const VALID_PLATFORM: Platform[] = ['fanatics_live', 'whatnot', 'ebay', 'dave_adams', 'layton_sports', 'local_card_shop', 'other'];
const VALID_REFERRAL: ReferralSource[] = ['word_of_mouth', 'youtube', 'social_media', 'google', 'reddit', 'referral', 'other'];
const VALID_ERAS = ['modern', '2010s', '2000s', '90s', '80s_earlier'];
const isDev = process.env.NODE_ENV === 'development';

export async function PUT(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let userId: string;
  if (user) {
    userId = user.id;
  } else if (isDev) {
    const { data } = await supabaseAdmin.from('profiles').select('id').limit(1).single();
    if (!data) return NextResponse.json({ error: 'No profiles in dev DB' }, { status: 500 });
    userId = data.id;
  } else {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      is_over_18,
      experience_level,
      favorite_sports,
      collecting_eras,
      primary_platform,
      monthly_spend,
      referral_source,
      best_pull,
    } = body;

    if (typeof is_over_18 !== 'boolean') {
      return NextResponse.json({ error: 'is_over_18 required' }, { status: 400 });
    }
    if (!VALID_EXPERIENCE.includes(experience_level)) {
      return NextResponse.json({ error: 'Invalid experience_level' }, { status: 400 });
    }
    if (!VALID_SPEND.includes(monthly_spend)) {
      return NextResponse.json({ error: 'Invalid monthly_spend' }, { status: 400 });
    }
    if (!VALID_PLATFORM.includes(primary_platform)) {
      return NextResponse.json({ error: 'Invalid primary_platform' }, { status: 400 });
    }
    if (!VALID_REFERRAL.includes(referral_source)) {
      return NextResponse.json({ error: 'Invalid referral_source' }, { status: 400 });
    }

    const cleanEras = Array.isArray(collecting_eras)
      ? collecting_eras.filter((e: string) => VALID_ERAS.includes(e))
      : [];

    const cleanSports = Array.isArray(favorite_sports)
      ? favorite_sports.map((s: string) => String(s).trim()).filter(Boolean)
      : [];

    const db = isDev && !user ? supabaseAdmin : supabase;
    const { error } = await db
      .from('profiles')
      .update({
        is_over_18,
        experience_level,
        favorite_sports: cleanSports,
        collecting_eras: cleanEras,
        primary_platform,
        monthly_spend,
        referral_source,
        best_pull: best_pull ? String(best_pull).trim().slice(0, 500) : null,
        onboarding_completed_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
