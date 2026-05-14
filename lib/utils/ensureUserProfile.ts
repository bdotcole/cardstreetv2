/**
 * Ensures the signed-in user has a `profiles` row AND at least one
 * `collections` row. Idempotent — safe to call on every Vault load.
 *
 * This is the second line of defense behind the `handle_new_user` auth
 * trigger. The trigger creates both rows on signup, but it can be missed
 * (legacy users, partial migrations, disabled trigger, admin-created users),
 * which manifests as a permanently empty Vault. Self-healing here means
 * we never have to manually fix a user's account again.
 */

import { createClient } from '@/lib/supabase/client';

export async function ensureUserProfile() {
    const supabase = createClient();

    try {
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            console.log('[ensureUserProfile] No authenticated user');
            return false;
        }

        // 1. Backfill profile row if missing.
        const { data: existingProfile, error: checkError } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', user.id)
            .maybeSingle();

        if (checkError) {
            console.error('[ensureUserProfile] Error checking profile:', checkError);
            throw checkError;
        }

        if (!existingProfile) {
            console.log('[ensureUserProfile] Creating missing profile for user:', user.id);

            const { error: insertProfileError } = await supabase
                .from('profiles')
                .insert({
                    id: user.id,
                    display_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
                    avatar_url: user.user_metadata?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.id}`
                });

            if (insertProfileError) {
                console.error('[ensureUserProfile] Error creating profile:', insertProfileError);
                throw insertProfileError;
            }
        }

        // 2. Backfill default Main Vault collection if the user has none.
        //    Runs every call — a single indexed lookup with .limit(1) is cheap,
        //    and this is the check that closes the "empty Vault" bug for users
        //    whose profile exists but collection row is missing.
        const { data: collections, error: collectionsCheckError } = await supabase
            .from('collections')
            .select('id')
            .eq('user_id', user.id)
            .limit(1);

        if (collectionsCheckError) {
            console.error('[ensureUserProfile] Error checking collections:', collectionsCheckError);
            // Don't throw — the caller will still try the main query.
            return true;
        }

        if (!collections || collections.length === 0) {
            console.log('[ensureUserProfile] Backfilling Main Vault collection for user:', user.id);
            const { error: collectionError } = await supabase
                .from('collections')
                .insert({
                    user_id: user.id,
                    name: 'Main Vault',
                    include_in_portfolio: true
                });

            if (collectionError) {
                console.error('[ensureUserProfile] Error creating default collection:', collectionError);
            }
        }

        return true;
    } catch (error) {
        console.error('[ensureUserProfile] Unexpected error:', error);
        return false;
    }
}
