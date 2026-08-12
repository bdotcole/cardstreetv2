import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/adminAuth'
import { APPLICATION_STATUSES, type ApplicationStatus } from '@/lib/breakerApplication'

/**
 * GET/PATCH /api/admin/breaker-applications/[id] — read one application in
 * full and record a review decision. Admin only.
 *
 * The panel also grants broadcast access, because until now nothing in the
 * app could: `live_broadcast` (lib/betaFeatures.ts) is the invite-only flag
 * that lets a seller host, and it was read everywhere and written nowhere.
 * Approving an applicant and granting them access are separate actions here
 * on purpose — an approval is a decision about a person, a grant is a change
 * to what their account can do, and one shouldn't silently imply the other.
 */

const BROADCAST_FLAG = 'live_broadcast'

/** Bounded scan of auth.users for an email. */
const AUTH_PAGE_SIZE = 1000
const AUTH_MAX_PAGES = 10

interface LinkedAccount {
    userId: string | null
    email: string | null
    displayName: string | null
    username: string | null
    hasBroadcast: boolean
    isAdmin: boolean
    stripeDetailsSubmitted: boolean
    stripeChargesEnabled: boolean
    /** How the account was found: the stamped user_id, or an email match. */
    matchedBy: 'user_id' | 'email' | null
    /** True when the email scan hit its page ceiling without a match. */
    lookupTruncated: boolean
}

/**
 * Find the auth user id for an email. Most applicants apply logged out, so the
 * application's `user_id` is null and the only link to an account is the email
 * they typed. Pages through auth.users (same service-role listUsers approach as
 * app/api/admin/users) rather than loading everything at once, and reports when
 * it gave up so the UI can say "not found" honestly instead of implying
 * "no account exists".
 */
async function findUserIdByEmail(
    admin: SupabaseClient,
    email: string,
): Promise<{ userId: string | null; truncated: boolean }> {
    const needle = email.trim().toLowerCase()
    if (!needle) return { userId: null, truncated: false }

    for (let page = 1; page <= AUTH_MAX_PAGES; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: AUTH_PAGE_SIZE })
        if (error) return { userId: null, truncated: true }
        const users = data?.users ?? []
        const hit = users.find((u) => (u.email ?? '').toLowerCase() === needle)
        if (hit) return { userId: hit.id, truncated: false }
        // Short page means we reached the end of the list.
        if (users.length < AUTH_PAGE_SIZE) return { userId: null, truncated: false }
    }
    return { userId: null, truncated: true }
}

async function resolveAccount(
    admin: SupabaseClient,
    application: { user_id: string | null; email: string },
): Promise<LinkedAccount> {
    const empty: LinkedAccount = {
        userId: null,
        email: null,
        displayName: null,
        username: null,
        hasBroadcast: false,
        isAdmin: false,
        stripeDetailsSubmitted: false,
        stripeChargesEnabled: false,
        matchedBy: null,
        lookupTruncated: false,
    }

    let userId = application.user_id
    let matchedBy: LinkedAccount['matchedBy'] = userId ? 'user_id' : null
    let truncated = false

    if (!userId) {
        const found = await findUserIdByEmail(admin, application.email)
        userId = found.userId
        truncated = found.truncated
        if (userId) matchedBy = 'email'
    }
    if (!userId) return { ...empty, lookupTruncated: truncated }

    const [{ data: profile }, { data: authUser }] = await Promise.all([
        admin
            .from('profiles')
            .select('display_name, username, beta_features, role, stripe_details_submitted, stripe_charges_enabled')
            .eq('id', userId)
            .maybeSingle(),
        admin.auth.admin.getUserById(userId),
    ])

    const flags: string[] = Array.isArray(profile?.beta_features) ? profile!.beta_features : []
    return {
        userId,
        email: authUser?.user?.email ?? null,
        displayName: profile?.display_name ?? null,
        username: profile?.username ?? null,
        hasBroadcast: flags.includes(BROADCAST_FLAG),
        isAdmin: profile?.role === 'admin',
        stripeDetailsSubmitted: profile?.stripe_details_submitted === true,
        stripeChargesEnabled: profile?.stripe_charges_enabled === true,
        matchedBy,
        lookupTruncated: truncated,
    }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const gate = await requireAdmin()
    if (gate) return gate

    const { id } = await params
    const admin = createAdminClient()

    const { data: application, error } = await admin
        .from('breaker_applications')
        .select('*')
        .eq('id', id)
        .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!application) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const account = await resolveAccount(admin, application)
    return NextResponse.json({ application, account })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const gate = await requireAdmin()
    if (gate) return gate

    const { id } = await params
    const admin = createAdminClient()
    const body = await request.json().catch(() => ({}))

    const { data: existing, error: readErr } = await admin
        .from('breaker_applications')
        .select('id, user_id, email, status')
        .eq('id', id)
        .maybeSingle()
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const updates: Record<string, unknown> = {}

    if ('status' in body) {
        if (!APPLICATION_STATUSES.includes(body.status as ApplicationStatus)) {
            return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
        }
        updates.status = body.status
    }
    if ('review_notes' in body) {
        const notes = typeof body.review_notes === 'string' ? body.review_notes.trim() : ''
        if (notes.length > 5000) {
            return NextResponse.json({ error: 'Review notes too long' }, { status: 400 })
        }
        updates.review_notes = notes || null
    }

    const wantsGrant = typeof body.grant_broadcast === 'boolean' ? body.grant_broadcast : null

    if (Object.keys(updates).length === 0 && wantsGrant === null) {
        return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    // Who reviewed it comes from the verified admin session, never the body.
    const cookieSupabase = await createServerClient()
    const { data: { user: adminUser } } = await cookieSupabase.auth.getUser()

    let grantResult: { changed: boolean; reason?: string } = { changed: false }

    if (wantsGrant !== null) {
        const account = await resolveAccount(admin, existing)
        if (!account.userId) {
            // Refuse rather than silently doing nothing — the reviewer clicked
            // a button and deserves to know why it had no effect.
            return NextResponse.json(
                {
                    error: account.lookupTruncated
                        ? 'Could not finish looking up an account for this email. Try again.'
                        : 'No CardStreet account is linked to this application. The applicant must sign up first.',
                    code: 'NO_LINKED_ACCOUNT',
                },
                { status: 409 },
            )
        }

        const { data: profile } = await admin
            .from('profiles')
            .select('beta_features')
            .eq('id', account.userId)
            .maybeSingle()

        const current: string[] = Array.isArray(profile?.beta_features) ? profile!.beta_features : []
        const has = current.includes(BROADCAST_FLAG)
        const next = wantsGrant
            ? (has ? current : [...current, BROADCAST_FLAG])
            : current.filter((f) => f !== BROADCAST_FLAG)

        if (has !== wantsGrant) {
            const { error: flagErr } = await admin
                .from('profiles')
                .update({ beta_features: next })
                .eq('id', account.userId)
            if (flagErr) {
                console.error('[Admin/BreakerApplications] flag update failed:', flagErr.message)
                return NextResponse.json({ error: flagErr.message }, { status: 500 })
            }
            grantResult = { changed: true }
        } else {
            grantResult = { changed: false, reason: 'already_in_that_state' }
        }

        // An application submitted logged-out has no user_id. Once the reviewer
        // has acted on a resolved account, stamp the link so the next reader
        // doesn't have to scan auth.users again.
        if (!existing.user_id) updates.user_id = account.userId
    }

    // Granting access is itself a review action, so stamp the reviewer even
    // when the status and notes weren't touched in the same request.
    if (Object.keys(updates).length > 0 || wantsGrant !== null) {
        updates.reviewed_by = adminUser?.id ?? null
        updates.reviewed_at = new Date().toISOString()
    }

    const { data: updated, error: writeErr } = await admin
        .from('breaker_applications')
        .update(updates)
        .eq('id', id)
        .select('*')
        .maybeSingle()

    if (writeErr) return NextResponse.json({ error: writeErr.message }, { status: 500 })

    const account = await resolveAccount(admin, updated ?? existing)
    return NextResponse.json({ application: updated, account, grant: grantResult })
}
