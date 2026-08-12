import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/adminAuth'
import { sanitizeOrFilterTerm } from '@/lib/utils/postgrestFilter'
import { APPLICATION_STATUSES, type ApplicationStatus } from '@/lib/breakerApplication'

/**
 * GET /api/admin/breaker-applications — the review queue for
 * /become-a-breaker submissions. Admin only.
 *
 * Returns list rows (enough to triage without opening each one) plus a tally
 * per status so the filter bar can show counts. Full answers live on the
 * detail route — the written sections are long and there is no reason to ship
 * six paragraphs per row into a list view.
 */

const PAGE_SIZE_DEFAULT = 100
const PAGE_SIZE_MAX = 200

// Enough to triage: who, where, what they play, and how far along they are.
const LIST_COLS =
    'id, status, full_name, email, phone, city, province, business_name, ' +
    'applicant_types, games, breaking_experience, setup_status, user_id, ' +
    'locale, submitted_at, reviewed_at'

export async function GET(request: Request) {
    const gate = await requireAdmin()
    if (gate) return gate

    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)

    const statusParam = searchParams.get('status')
    const status = APPLICATION_STATUSES.includes(statusParam as ApplicationStatus)
        ? (statusParam as ApplicationStatus)
        : null
    const search = (searchParams.get('search') ?? '').trim()
    const limit = Math.min(
        Number(searchParams.get('limit')) || PAGE_SIZE_DEFAULT,
        PAGE_SIZE_MAX,
    )
    const offset = Math.max(Number(searchParams.get('offset')) || 0, 0)

    let query = supabase
        .from('breaker_applications')
        .select(LIST_COLS, { count: 'exact' })
        .order('submitted_at', { ascending: false })
        .range(offset, offset + limit - 1)

    if (status) query = query.eq('status', status)
    if (search) {
        // Shared sanitizer (lib/utils/postgrestFilter): a raw term is parsed as
        // or() filter syntax, so its delimiters — and the LIKE wildcard — have
        // to go. Empty after sanitizing means skip the filter, not match on %%.
        const safe = sanitizeOrFilterTerm(search)
        if (safe) {
            query = query.or(
                `full_name.ilike.%${safe}%,email.ilike.%${safe}%,business_name.ilike.%${safe}%,cardstreet_username.ilike.%${safe}%`,
            )
        }
    }

    const { data, error, count } = await query
    if (error) {
        // The migration not being applied is the one failure worth naming.
        console.error('[Admin/BreakerApplications] list failed:', error.message)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Status tally for the filter bar. One extra round trip over a single
    // column, rather than one count query per status.
    const counts: Record<string, number> = Object.fromEntries(
        APPLICATION_STATUSES.map((s) => [s, 0]),
    )
    const { data: allStatuses } = await supabase.from('breaker_applications').select('status')
    for (const row of allStatuses ?? []) {
        const key = (row as { status: string }).status
        if (key in counts) counts[key] += 1
    }

    return NextResponse.json({
        applications: data ?? [],
        total: count ?? 0,
        counts,
    })
}
