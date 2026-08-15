import { NextResponse, after } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, requestIp } from '@/lib/rateLimit'
import { sendBreakerApplicationAlert, sendBreakerApplicationConfirmation } from '@/lib/courier'
import { BreakerApplicationSchema } from '@/lib/breakerApplication'

/**
 * Public intake for the Cardstreet Live breaker program (/become-a-breaker).
 *
 * Unauthenticated by design — most of the target audience is currently selling
 * on Facebook/TikTok and has no CardStreet account yet. That makes this the
 * only anon-writable surface in the app, so the write goes through the
 * service-role client while the table itself has NO insert policy (see
 * supabase/migrations/20260809_breaker_applications.sql): nothing can write a
 * row except this handler, and this handler only writes what the shared zod
 * schema accepts.
 *
 * Three layers of abuse protection, cheapest first:
 *   1. honeypot  — a hidden `website` field no human sees
 *   2. rate limit — per IP, the same DB-backed limiter the rest of the app uses
 *   3. duplicate guard — one open application per email address
 */

// Generous enough for a household or a shop where two people apply from the
// same connection, tight enough that a script can't dump the table full.
const RATE_LIMIT = { windowSeconds: 3600, max: 5 }

/** An applicant with a live application shouldn't be able to queue up more. */
const OPEN_STATUSES = ['new', 'reviewing', 'test_stream', 'approved']

export async function POST(request: NextRequest) {
    let body: unknown
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid request body', code: 'BAD_REQUEST' }, { status: 400 })
    }

    const parsed = BreakerApplicationSchema.safeParse(body)
    if (!parsed.success) {
        return NextResponse.json(
            {
                error: 'Some answers need another look.',
                code: 'VALIDATION_FAILED',
                // Field-keyed so the client can attach each message to its input
                // rather than showing one generic banner.
                fields: parsed.error.flatten().fieldErrors,
            },
            { status: 400 },
        )
    }

    const input = parsed.data

    // 1. Honeypot. Answer 200 so a bot can't tell it was filtered and retry
    //    with the field cleared — but write nothing.
    if (input.website.trim()) {
        return NextResponse.json({ ok: true })
    }

    // 2. Per-IP rate limit. Fails open (a limiter outage must not close the
    //    only door into the program).
    const ip = requestIp(request)
    const { allowed } = await checkRateLimit(`breaker-application:${ip}`, RATE_LIMIT)
    if (!allowed) {
        return NextResponse.json(
            { error: 'Too many applications from this connection. Please try again later.', code: 'RATE_LIMITED' },
            { status: 429 },
        )
    }

    // Signed-in applicants get their account stamped on the row so the reviewer
    // can see the existing profile. Read from the session cookie, never from
    // the body — a client-supplied user id would be trivially forgeable.
    let userId: string | null = null
    try {
        const supabase = await createClient()
        const { data } = await supabase.auth.getUser()
        userId = data.user?.id ?? null
    } catch {
        // Anonymous applicant, or auth unavailable — neither blocks the form.
    }

    const admin = createAdminClient()
    const email = input.email.toLowerCase()

    // 3. Duplicate guard. A rejected or withdrawn applicant may reapply; an
    //    applicant already in the queue may not.
    const { data: existing, error: existingError } = await admin
        .from('breaker_applications')
        .select('id, status')
        .eq('email', email)
        .in('status', OPEN_STATUSES)
        .limit(1)

    if (existingError) {
        console.error('[BreakerApplication] duplicate check failed:', existingError.message)
        return NextResponse.json(
            { error: 'We could not submit your application. Please try again.', code: 'SERVER_ERROR' },
            { status: 500 },
        )
    }
    if (existing && existing.length > 0) {
        return NextResponse.json(
            {
                error: 'We already have an application from this email address.',
                code: 'DUPLICATE_APPLICATION',
            },
            { status: 409 },
        )
    }

    // All three consent boxes are `z.literal(true)`, so reaching here means all
    // three were ticked in this submission — one timestamp for the lot.
    const consentedAt = new Date().toISOString()

    const { data: inserted, error } = await admin.from('breaker_applications').insert({
        user_id: userId,
        status: 'new',
        locale: input.locale,

        full_name: input.fullName,
        email,
        phone: input.phone,
        line_id: input.lineId || null,
        city: input.city,
        province: input.province,
        preferred_language: input.preferredLanguage,
        is_adult: input.isAdult,

        applicant_types: input.applicantTypes,
        applicant_type_other: input.applicantTypeOther || null,
        business_name: input.businessName || null,
        social_links: input.socialLinks,
        cardstreet_username: input.cardstreetUsername || null,

        games: input.games,
        games_other: input.gamesOther || null,
        breaking_experience: input.breakingExperience,
        experience_summary: input.experienceSummary,
        sample_video_url: input.sampleVideoUrl || null,

        availability: input.availability,
        break_types: input.breakTypes,
        inventory_notes: input.inventoryNotes || null,

        consent_accurate_at: consentedAt,
        consent_no_guarantee_at: consentedAt,
        consent_terms_at: consentedAt,

        utm: input.utm,
        referrer: input.referrer || null,
    })
        .select('id')
        .single()

    if (error) {
        // The migration not being applied yet is the one failure mode worth
        // naming in the logs — everything else is a genuine write error.
        console.error('[BreakerApplication] insert failed:', error.message)
        return NextResponse.json(
            { error: 'We could not submit your application. Please try again.', code: 'SERVER_ERROR' },
            { status: 500 },
        )
    }

    // Both emails go out after the response is sent. The application is already
    // committed, so a Courier outage costs us a notification, not a lead — and
    // the applicant never waits on an email round trip.
    //
    // allSettled, not Promise.all: the team alert and the applicant's receipt
    // are independent, and one failing must not suppress the other.
    after(async () => {
        const [alert, confirmation] = await Promise.allSettled([
            sendBreakerApplicationAlert({
                id: inserted.id,
                fullName: input.fullName,
                email,
                phone: input.phone,
                city: input.city,
                province: input.province,
                businessName: input.businessName || null,
                applicantTypes: input.applicantTypes,
                games: input.games,
                breakingExperience: input.breakingExperience,
                availability: input.availability,
                locale: input.locale,
                hasAccount: Boolean(userId),
                utm: input.utm,
            }),
            sendBreakerApplicationConfirmation({
                email,
                fullName: input.fullName,
                preferredLanguage: input.preferredLanguage,
                locale: input.locale,
            }),
        ])
        if (alert.status === 'rejected') {
            console.error('[BreakerApplication] team alert failed:', alert.reason)
        }
        if (confirmation.status === 'rejected') {
            console.error('[BreakerApplication] applicant confirmation failed:', confirmation.reason)
        }
    })

    // Deliberately no id in the response: the form only needs to know it landed,
    // and an unauthenticated caller has no use for a row id.
    return NextResponse.json({ ok: true })
}
