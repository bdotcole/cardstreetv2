/**
 * Slab Packs — who can open the prototype. Server-only (service-role read).
 *
 * The feature sits behind the admin wall: an admin by role gets in, everyone
 * else gets the same 404 a missing route would give. It is deliberately NOT
 * a lib/betaFeatures entry yet. That system's kill switch needs a seeded
 * beta_feature_flags row, and nothing here touches money, so a role check is
 * the whole gate. When packs take real payments, give them a BetaFeature and
 * route every money-touching call through requireBeta().
 */

import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function hasSlabPacksAccess(): Promise<boolean> {
    // Local development only: lets the preview be opened and screenshotted
    // without an admin session. `next build` and every Vercel deployment run
    // with NODE_ENV=production, where this branch cannot be taken whatever the
    // env var says.
    if (process.env.NODE_ENV === 'development' && process.env.SLAB_PACKS_DEV_OPEN === '1') return true;

    try {
        const supabase = await createServerClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return false;
        const { data: profile } = await createAdminClient()
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();
        return profile?.role === 'admin';
    } catch {
        // Fail closed: a lookup error must never open the door.
        return false;
    }
}
