import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card } from '@/types';
import { ensureUserProfile } from '@/lib/utils/ensureUserProfile';
import { trackEngagement } from '@/lib/engagementEvents';

interface UseWishlistReturn {
    wishlist: Card[];
    isLoading: boolean;
    error: string | null;
    addToWishlist: (card: Card) => Promise<void>;
    removeFromWishlist: (cardId: string) => Promise<void>;
    isInWishlist: (cardId: string) => boolean;
    refreshWishlist: () => Promise<void>;
}

export function useWishlist(): UseWishlistReturn {
    const [wishlist, setWishlist] = useState<Card[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadWishlist = async () => {
        const supabase = createClient();

        try {
            const { data: { user } } = await supabase.auth.getUser();

            if (!user) {
                // Guest user - return empty wishlist
                setWishlist([]);
                setIsLoading(false);
                return;
            }

            const { data, error: wishlistError } = await supabase
                .from('wishlists')
                .select('*')
                .eq('user_id', user.id)
                .order('added_at', { ascending: false });

            if (wishlistError) throw wishlistError;

            const cards = (data || []).map(item => item.card_data as Card);
            setWishlist(cards);
            setError(null);
        } catch (err: any) {
            console.error('Error loading wishlist:', err);
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadWishlist();
    }, []);

    const addToWishlist = async (card: Card) => {
        const supabase = createClient();

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Must be signed in to add to wishlist');

            // Ensure user profile exists (for legacy users)
            await ensureUserProfile();

            const { error } = await supabase
                .from('wishlists')
                .insert({
                    user_id: user.id,
                    card_id: card.id,
                    card_data: card
                });

            if (error) {
                // Ignore unique constraint violations (card already in wishlist)
                if (error.code === '23505') return;
                throw error;
            }

            // After the insert, and after the duplicate short-circuit above: a
            // re-add of a card already wishlisted awards nothing in the ledger
            // and must not inflate the GA count either.
            trackEngagement('wishlist_add', { card_id: card.id, game: card.game ?? '' });

            setWishlist(prev => [card, ...prev]);
        } catch (err: any) {
            console.error('Error adding to wishlist:', err);
            setError(err.message);
            throw err;
        }
    };

    const removeFromWishlist = async (cardId: string) => {
        const supabase = createClient();

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Must be signed in');

            const { error } = await supabase
                .from('wishlists')
                .delete()
                .eq('user_id', user.id)
                .eq('card_id', cardId);

            if (error) throw error;

            setWishlist(prev => prev.filter(card => card.id !== cardId));
        } catch (err: any) {
            console.error('Error removing from wishlist:', err);
            setError(err.message);
            throw err;
        }
    };

    const isInWishlist = (cardId: string): boolean => {
        return wishlist.some(card => card.id === cardId);
    };

    const refreshWishlist = async () => {
        setIsLoading(true);
        await loadWishlist();
    };

    return {
        wishlist,
        isLoading,
        error,
        addToWishlist,
        removeFromWishlist,
        isInWishlist,
        refreshWishlist
    };
}
