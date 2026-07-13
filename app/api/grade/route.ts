import { NextResponse } from 'next/server';
import { requirePremium } from '@/lib/premiumAuth';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { gradeCard, type GradeAngle, type GradeImageInput } from '@/services/graderService';
import { checkRateLimit } from '@/lib/rateLimit';

// nodejs runtime is required: graderService uses `sharp` (a native module) to
// normalize the photos, which is unavailable on Edge.
export const runtime = 'nodejs';
// Bounded by a single Gemini Flash vision call over a few images (~5-15s).
export const maxDuration = 60;

const VALID_ANGLES: GradeAngle[] = ['front', 'back', 'surface'];

export async function POST(req: Request) {
  // Authoritative gate -- AI grading is a premium feature.
  const gate = await requirePremium();
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  // Each grade is a paid Gemini vision call. Premium-gated but otherwise
  // uncapped — bound per user so one subscriber can't run up unbounded spend.
  const rl = await checkRateLimit(`grade:${user.id}:1d`, { windowSeconds: 86400, max: 20 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Daily grading limit reached. Please try again tomorrow.' },
      { status: 429, headers: { 'Retry-After': '3600' } },
    );
  }

  try {
    const body = await req.json();

    const rawImages = Array.isArray(body.images) ? body.images : [];
    const images: GradeImageInput[] = rawImages
      .filter(
        (i: any) =>
          i && typeof i.image === 'string' && VALID_ANGLES.includes(i.angle),
      )
      .slice(0, 5);

    if (images.length === 0) {
      return NextResponse.json(
        { error: 'Provide at least a front photo of the card.' },
        { status: 400 },
      );
    }

    const result = await gradeCard(images);

    // Persist the estimate for the user's grading history (best-effort: a save
    // failure must not lose the result the user just waited for).
    const supabase = await createServerClient();
    const { data: saved, error: saveErr } = await supabase
      .from('grade_estimates')
      .insert({
        user_id: user.id,
        card_id: typeof body.cardId === 'string' ? body.cardId : null,
        card_name: typeof body.cardName === 'string' ? body.cardName : null,
        game: typeof body.game === 'string' ? body.game : null,
        overall: result.overall,
        centering: result.centering,
        corners: result.corners,
        edges: result.edges,
        surface: result.surface,
        confidence: result.confidence,
        notes: result.notes,
      })
      .select('id')
      .single();
    if (saveErr) console.error('[API /api/grade] save failed:', saveErr.message);

    return NextResponse.json({ ...result, id: saved?.id ?? null });
  } catch (error: any) {
    console.error('API /api/grade Error:', error);

    if (error.message?.includes('API key') || error.message?.includes('GEMINI_API_KEY')) {
      return NextResponse.json(
        { error: 'Grading is not configured. Please set GEMINI_API_KEY.' },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message || 'Grading failed' }, { status: 500 });
  }
}
