import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { mapSupabaseCardToInternal } from '@/lib/cardMapper';
import { resolveCandidates, unitValueThb } from '@/lib/collectionImport/resolve';
import { ParsedRow, ResolvedRow, ResolvedCandidate, ResolveStatus } from '@/lib/collectionImport/types';

// Preview endpoint for the partner bulk importer: resolves each parsed inventory
// line to catalog candidates and computes the (graded-aware) value it would book,
// WITHOUT writing anything. Partner-gated. `sharp`-free, but keep nodejs for parity.
export const runtime = 'nodejs';

const MAX_ROWS = 1000;
const MAX_CANDIDATES = 6;

// Run `fn` over `items` with bounded concurrency (each item is a few DB round-trips).
async function pool<T, R>(items: T[], size: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const worker = async () => {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await fn(items[cur], cur);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) || 1 }, worker));
  return results;
}

export async function POST(request: NextRequest) {
  // --- Auth + partner gate (admins allowed through for testing) ---------------
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

  const rows: ParsedRow[] = Array.isArray(body?.rows) ? body.rows.slice(0, MAX_ROWS) : [];
  if (rows.length === 0) return NextResponse.json({ rows: [], summary: emptySummary() });

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const resolved = await pool<ParsedRow, ResolvedRow>(rows, 8, async (row) => {
    if (row.parseError || !row.set || !row.number) {
      return { rowIndex: row.rowIndex, input: row, status: 'error', candidates: [], message: row.parseError || 'Missing set or number' };
    }

    const graded = { isGraded: !!row.isGraded, gradingCompany: row.gradingCompany, grade: row.grade };
    const cands = await resolveCandidates(admin, {
      set: row.set,
      number: row.number,
      language: row.language || null,
      game: row.game || null,
      name: row.name || null,
    });

    if (cands.length === 0) {
      return { rowIndex: row.rowIndex, input: row, status: 'unmatched', candidates: [], message: 'No catalog match for this set + number' };
    }

    const candidates: ResolvedCandidate[] = cands.slice(0, MAX_CANDIDATES).map((c: any) => {
      const mapped = mapSupabaseCardToInternal(c);
      return {
        id: mapped.id,
        name: mapped.name,
        set: mapped.set,
        number: mapped.number,
        image: mapped.images?.small || mapped.imageUrl,
        language: mapped.language || 'en',
        marketPrice: Math.round(mapped.marketPrice || 0),
        value: unitValueThb(mapped, c.market_values, graded),
      };
    });

    const status: ResolveStatus = candidates.length === 1 ? 'matched' : 'ambiguous';
    return { rowIndex: row.rowIndex, input: row, status, candidates };
  });

  return NextResponse.json({ rows: resolved, summary: summarize(resolved) });
}

function emptySummary() {
  return { matched: 0, ambiguous: 0, unmatched: 0, error: 0 };
}
function summarize(rows: ResolvedRow[]) {
  const s = emptySummary();
  for (const r of rows) s[r.status] += 1;
  return s;
}
