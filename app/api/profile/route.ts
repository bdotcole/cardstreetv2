import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { isValidThaiPhone, normalizePhone } from '@/lib/utils/phone'
import { validateThaiAddressTrio } from '@/lib/thaiAdminAreas'

// GET - Fetch current user's profile with settings and rewards
export async function GET() {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        // Fetch profile
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single()

        if (profileError) throw profileError

        // Fetch settings
        const { data: settings } = await supabase
            .from('user_settings')
            .select('*')
            .eq('user_id', user.id)
            .single()

        // Fetch rewards
        const { data: rewards } = await supabase
            .from('rewards')
            .select('*')
            .eq('user_id', user.id)
            .single()

        // Live-show blast prefs live in notification_preferences, not
        // user_settings — that is the table lib/courier.ts actually reads when
        // deciding who gets a blast. Folded into the same `settings` object so
        // both settings screens keep one shape to render. A missing row (web-only
        // accounts never get one; it is created when a device registers an FCM
        // token) and a pre-migration column both resolve to opted-in, matching
        // the `!== false` convention used everywhere else.
        const { data: notifPrefs } = await supabase
            .from('notification_preferences')
            .select('show_live_email, show_live_push')
            .eq('user_id', user.id)
            .maybeSingle()

        const blastPrefs = {
            show_live_email: (notifPrefs as { show_live_email?: boolean } | null)?.show_live_email !== false,
            show_live_push: (notifPrefs as { show_live_push?: boolean } | null)?.show_live_push !== false,
        }

        return NextResponse.json({
            profile,
            settings: {
                ...(settings || {
                    phone_number: null,
                    shipping_address: {},
                    two_factor_enabled: false,
                    notify_price_drops: true,
                    notify_order_updates: true,
                    notify_marketing: false
                }),
                ...blastPrefs
            },
            rewards: rewards || {
                points_balance: 0,
                tier: 'bronze',
                lifetime_points: 0,
                tier_progress: 0
            }
        })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

// PATCH - Update profile info (name, phone, address fields, and username)
export async function PATCH(request: NextRequest) {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const body = await request.json()
        const { display_name, phone_number, address, district, state, province, postcode, sub_district, username, bio } = body

        // Prepare profile update
        const profileUpdate: any = {}
        if (display_name !== undefined) profileUpdate.display_name = display_name
        if (phone_number !== undefined) {
            // Allow clearing the phone (so a user with no number can still edit
            // other fields — e.g. bio-only saves), but reject a non-empty value
            // that isn't a valid TH number and store the normalized digits so
            // downstream Flash waybills get clean input. Purchase is gated on a
            // valid phone separately in /api/orders/checkout.
            if (phone_number === null || (typeof phone_number === 'string' && phone_number.trim() === '')) {
                profileUpdate.phone_number = null
            } else if (typeof phone_number === 'string' && isValidThaiPhone(phone_number)) {
                profileUpdate.phone_number = normalizePhone(phone_number)
            } else {
                return NextResponse.json(
                    { error: 'Please enter a valid Thai phone number (e.g. 081 234 5678).', code: 'INVALID_PHONE' },
                    { status: 400 },
                )
            }
        }
        if (bio !== undefined) {
            if (bio !== null && typeof bio !== 'string') {
                return NextResponse.json({ error: 'Invalid bio.' }, { status: 400 })
            }
            profileUpdate.bio = bio ? bio.trim().slice(0, 500) : null
        }
        if (address !== undefined) profileUpdate.address = address
        if (district !== undefined) profileUpdate.district = district
        if (state !== undefined) profileUpdate.state = state
        if (province !== undefined) profileUpdate.province = province
        if (postcode !== undefined) profileUpdate.postcode = postcode
        if (sub_district !== undefined) profileUpdate.sub_district = sub_district

        // The address forms send province/state/district together. When the
        // trio resolves against the canonical dataset, store canonical names —
        // and correct the khet↔khwaeng swap free-text entry used to produce
        // (profiles.state = อำเภอ/เขต, profiles.district = ตำบล/แขวง; a swap
        // here is what made Flash reject order d307f84c's waybill). Values
        // that don't resolve are stored as-is so older clients keep working —
        // fulfillment has its own dataset-backed retry (lib/flashExpress.ts).
        if (
            typeof profileUpdate.province === 'string' && profileUpdate.province.trim() &&
            typeof profileUpdate.state === 'string' && profileUpdate.state.trim() &&
            typeof profileUpdate.district === 'string' && profileUpdate.district.trim()
        ) {
            const trio = validateThaiAddressTrio({
                province: profileUpdate.province,
                district: profileUpdate.state,
                subdistrict: profileUpdate.district,
            })
            if (trio.status !== 'invalid') {
                if (trio.status === 'swapped') {
                    console.warn(`[Profile] Corrected swapped district/sub-district for user ${user.id}`)
                }
                profileUpdate.province = trio.canonical.province
                profileUpdate.state = trio.canonical.district
                profileUpdate.district = trio.canonical.subdistrict
                // The dataset's per-subdistrict zip beats a missing or
                // mismatched hand-typed one.
                const givenPostcode = typeof profileUpdate.postcode === 'string' ? profileUpdate.postcode.trim() : ''
                if (givenPostcode !== trio.canonical.postcode) {
                    profileUpdate.postcode = trio.canonical.postcode
                }
            }
        }

        // Username update logic
        if (username) {
            // Validate username characters (alphanumeric and underscores only)
            const cleanUsername = username.toLowerCase().replace(/[^a-z0-9_]/g, '');
            if (cleanUsername !== username.toLowerCase() || cleanUsername.length < 3) {
                return NextResponse.json({ error: 'Username must be at least 3 characters and contain only letters, numbers, and underscores.' }, { status: 400 })
            }

            // Check cooldown
            const { data: currentProfile } = await supabase
                .from('profiles')
                .select('username, username_updated_at')
                .eq('id', user.id)
                .single();

            if (currentProfile?.username !== cleanUsername) {
                if (currentProfile?.username_updated_at) {
                    const lastUpdated = new Date(currentProfile.username_updated_at);
                    const daysSinceUpdate = (new Date().getTime() - lastUpdated.getTime()) / (1000 * 3600 * 24);
                    
                    if (daysSinceUpdate < 30) {
                        return NextResponse.json({ error: `You can only change your username once every 30 days. Please wait ${Math.ceil(30 - daysSinceUpdate)} more days.` }, { status: 400 })
                    }
                }

                // Check uniqueness (handled by Postgres UNIQUE constraint, but good to check early)
                const { data: existingUser } = await supabase
                    .from('profiles')
                    .select('id')
                    .eq('username', cleanUsername)
                    .neq('id', user.id)
                    .maybeSingle();

                if (existingUser) {
                    return NextResponse.json({ error: 'This username is already taken.' }, { status: 400 })
                }

                profileUpdate.username = cleanUsername;
                profileUpdate.username_updated_at = new Date().toISOString();
            }
        }

        if (Object.keys(profileUpdate).length > 0) {
            let { error: profileError } = await supabase
                .from('profiles')
                .update(profileUpdate)
                .eq('id', user.id)

            // profiles.bio may not exist yet (migration 20260705_profile_bio
            // pending). Don't let that fail the rest of the profile save —
            // retry without bio; it starts persisting once the column exists.
            if (profileError && 'bio' in profileUpdate &&
                (profileError.code === 'PGRST204' || profileError.code === '42703')) {
                const { bio: _bio, ...rest } = profileUpdate
                if (Object.keys(rest).length > 0) {
                    ({ error: profileError } = await supabase
                        .from('profiles')
                        .update(rest)
                        .eq('id', user.id))
                } else {
                    profileError = null
                }
            }

            if (profileError) {
                if (profileError.code === '23505') { // Postgres unique violation error code
                    return NextResponse.json({ error: 'This username is already taken.' }, { status: 400 });
                }
                throw profileError;
            }
        }

        return NextResponse.json({ success: true, updatedFields: profileUpdate })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
