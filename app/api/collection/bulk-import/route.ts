import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { buildSnapshot } from '@/lib/collectionImport/resolve';
import { ImportRow } from '@/lib/collectionImport/types';

// Writes confirmed importer rows into the partner's collection. Partner-gated;
// verifies the target collection belongs to the caller, builds each card_data
// snapshot server-side (client can't inject arbitrary values), and books graded
// value into the snapshot. nodejs runtime for parity with the rest of the pipeline.
export const runtime = 'nodejs';

const MAX_ROWS = 1000;
const CARD_SELECT = '*, market_values(condition, market_avg, currency, last_updated), pokemon_sets(name, printed_total, total)';
const GRADED_KEYS = ['is_graded', 'grading_company', 'grade'] as const;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function POST(request: NextRequest) {
  const server = await createServerClient();
  const { data: { user } } = await server.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await server
    .from('profiles')
    .select('partner_joined_at, role')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile?.partner_joined_at && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Partner access required', code: 'NOT_PARTNER' }, { status: 403 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const collectionId: string | undefined = body?.collectionId;
  const items: ImportRow[] = Array.isArray(body?.items) ? body.items.slice(0, MAX_ROWS) : [];
  if (!collectionId) return NextResponse.json({ error: 'Missing collectionId' }, { status: 400 });
  if (items.length === 0) return NextResponse.json({ error: 'No items to import' }, { status: 400 });

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Ownership check — admin bypasses RLS, so verify the collection is the caller's.
  const { data: col } = await admin
    .from('collections')
    .select('id, user_id')
    .eq('id', collectionId)
    .maybeSingle();
  if (!col || col.user_id !== user.id) {
    return NextResponse.json({ error: 'Collection not found', code: 'NOT_OWNER' }, { status: 403 });
  }

  // Fetch every referenced catalog card once, keyed by id.
  const ids = [...new Set(items.map((it) => it.cardId).filter(Boolean))];
  const cardById = new Map<string, any>();
  for (const idChunk of chunk(ids, 200)) {
    const { data } = await admin.from('pokemon_cards').select(CARD_SELECT).in('id', idChunk);
    for (const c of data || []) cardById.set(c.id, c);
  }

  const failed: { cardId: string; reason: string }[] = [];
  const inserts: Record<string, any>[] = [];
  for (const it of items) {
    const cardRow = cardById.get(it.cardId);
    if (!cardRow) {
      failed.push({ cardId: it.cardId, reason: 'Card not found in catalog' });
      continue;
    }
    const graded = { isGraded: !!it.isGraded, gradingCompany: it.gradingCompany, grade: it.grade };
    const { card, value } = buildSnapshot(cardRow, graded);
    inserts.push({
      collection_id: collectionId,
      card_id: card.id,
      card_data: card,
      quantity: it.quantity && it.quantity > 0 ? it.quantity : 1,
      condition: it.condition,
      purchase_price: it.purchasePrice != null && it.purchasePrice > 0 ? it.purchasePrice : value,
      is_graded: graded.isGraded,
      grading_company: graded.isGraded ? graded.gradingCompany ?? null : null,
      grade: graded.isGraded ? graded.grade ?? null : null,
    });
  }

  if (inserts.length === 0) {
    return NextResponse.json({ imported: 0, failed });
  }

  let imported = 0;
  let stripGraded = false; // set once if the graded columns aren't in the DB yet
  for (const batch of chunk(inserts, 100)) {
    const payload = stripGraded ? batch.map(stripGradedCols) : batch;
    let { error } = await admin.from('collection_items').insert(payload);

    // Graded columns may not exist yet (migration 20260707_collection_graded
    // pending). Fall back to inserting without them so non-graded value (already
    // baked into card_data.marketPrice) still imports; the flags start persisting
    // once the migration runs. Mirrors the profiles.bio degrade in /api/profile.
    if (error && (error.code === 'PGRST204' || error.code === '42703')) {
      stripGraded = true;
      ({ error } = await admin.from('collection_items').insert(batch.map(stripGradedCols)));
    }

    if (error) {
      console.error('[bulk-import] insert error:', error);
      for (const row of batch) failed.push({ cardId: row.card_id, reason: error.message });
    } else {
      imported += payload.length;
    }
  }

  return NextResponse.json({ imported, failed, gradedColumnsMissing: stripGraded });
}

function stripGradedCols(row: Record<string, any>): Record<string, any> {
  const copy = { ...row };
  for (const k of GRADED_KEYS) delete copy[k];
  return copy;
}
