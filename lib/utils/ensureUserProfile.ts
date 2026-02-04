/**
 * Utility function to ensure a user profile exists in the database
 * This handles the case where users signed up before the profile trigger was created
 */

import { createClient } from '@/lib/supabase/client';

export async function ensureUserProfile() {
    const supabase = createClient();

    try {
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            console.log('No authenticated user');
            return false;
        }

        // Check if profile exists
        const { data: existingProfile, error: checkError } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', user.id)
            .single();

        if (checkError && checkError.code !== 'PGRST116') {
            // PGRST116 is "not found", which is okay - we'll create it
            console.error('Error checking profile:', checkError);
            throw checkError;
        }

        if (existingProfile) {
            console.log('Profile exists');
            return true;
        }

        // Profile doesn't exist - create it
        console.log('Creating missing profile for user:', user.id);

        const { error: insertProfileError } = await supabase
            .from('profiles')
            .insert({
                id: user.id,
                display_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
                avatar_url: user.user_metadata?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.id}`
            });

        if (insertProfileError) {
            console.error('Error creating profile:', insertProfileError);
            throw insertProfileError;
        }

        // Also create a default collection if none exists
        const { data: collections } = await supabase
            .from('collections')
            .select('id')
            .eq('user_id', user.id);

        if (!collections || collections.length === 0) {
            console.log('Creating default Main Vault collection');
            const { error: collectionError } = await supabase
                .from('collections')
                .insert({
                    user_id: user.id,
                    name: 'Main Vault',
                    include_in_portfolio: true
                });

            if (collectionError) {
                console.error('Error creating default collection:', collectionError);
                // Don't throw here - profile creation is more critical
            }
        }

        return true;
    } catch (error) {
        console.error('Error in ensureUserProfile:', error);
        return false;
    }
}
