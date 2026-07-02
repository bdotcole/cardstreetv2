import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, UserCollectionItem, CardCondition, CustomCollection } from '@/types';
import { ensureUserProfile } from '@/lib/utils/ensureUserProfile';
import { normalizeCard } from '@/lib/utils/normalizeCard';

interface UseUserCollectionsReturn {
    collections: CustomCollection[];
    isLoading: boolean;
    error: string | null;
    addCollection: (name: string, includeInPortfolio?: boolean) => Promise<string>;
    deleteCollection: (collectionId: string) => Promise<void>;
    updateCollection: (collectionId: string, updates: Partial<CustomCollection>) => Promise<void>;
    addCardToCollection: (collectionId: string, card: Card, details?: Partial<UserCollectionItem>) => Promise<void>;
    removeCardFromCollection: (collectionId: string, itemId: string) => Promise<void>;
    updateCollectionItem: (collectionId: string, itemId: string, updates: Partial<UserCollectionItem>) => Promise<void>;
    refreshCollections: () => Promise<void>;
}

export function useUserCollections(): UseUserCollectionsReturn {
    const [collections, setCollections] = useState<CustomCollection[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadCollections = async () => {
        const supabase = createClient();

        try {
            const { data: { user } } = await supabase.auth.getUser();

            if (!user) {
                // Guest user - return empty collections
                setCollections([]);
                setIsLoading(false);
                return;
            }

            // Heal legacy accounts that signed up before the profile/default-collection
            // trigger existed (or where it silently failed). Without this, those users
            // see an empty Vault forever because they have no rows in `collections`.
            await ensureUserProfile();

            // Fetch collections with their items
            const { data: collectionsData, error: collectionsError } = await supabase
                .from('collections')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: true });

            if (collectionsError) throw collectionsError;

            // Fetch all collection items for this user
            const collectionIds = collectionsData?.map(c => c.id) || [];

            const { data: itemsData, error: itemsError } = await supabase
                .from('collection_items')
                .select('*')
                .in('collection_id', collectionIds);

            if (itemsError) throw itemsError;

            // Fetch user's active listings to map them to vault items
            const { data: listingsData, error: listingsError } = await supabase
                .from('listings')
                .select('*')
                .eq('seller_id', user.id)
                .eq('status', 'active');

            if (listingsError) throw listingsError;

            // Map listings by card_id for easy consumption
            // If user has multiple listings for same card, we keep an array to match multiple items
            const userListingsMap: Record<string, any[]> = {};
            (listingsData || []).forEach(listing => {
                if (!userListingsMap[listing.card_id]) {
                    userListingsMap[listing.card_id] = [];
                }
                userListingsMap[listing.card_id].push(listing);
            });

            // Group items by collection
            const collectionsWithItems: CustomCollection[] = (collectionsData || []).map(col => ({
                id: col.id,
                name: col.name,
                includeInPortfolio: col.include_in_portfolio,
                createdAt: col.created_at,
                items: (itemsData || [])
                    .filter(item => item.collection_id === col.id)
                    .map(item => {
                        // Find a matching listing for this item (matching card ID and condition ideally)
                        let matchedListing: any = null;
                        const potentialListings = userListingsMap[item.card_id];

                        if (potentialListings && potentialListings.length > 0) {
                            // Try to match by condition first
                            const exactMatchIdx = potentialListings.findIndex(l => l.condition === item.condition);
                            if (exactMatchIdx !== -1) {
                                matchedListing = potentialListings.splice(exactMatchIdx, 1)[0];
                            } else {
                                // Fallback to any listing for same card
                                matchedListing = potentialListings.shift();
                            }
                        }

                        return {
                            id: item.id,
                            cardId: item.card_id,
                            // Normalize: legacy rows can have null `set` / `number` /
                            // `marketPrice` in card_data, which crashed the Vault.
                            card: normalizeCard(item.card_data, item.card_id),
                            quantity: item.quantity,
                            condition: item.condition as CardCondition,
                            purchasePrice: parseFloat(item.purchase_price || '0'),
                            addedAt: item.added_at,
                            isListing: !!matchedListing,
                            listingPrice: matchedListing ? parseFloat(matchedListing.price) : undefined,
                            isGraded: matchedListing ? matchedListing.is_graded : false,
                            gradingCompany: matchedListing ? matchedListing.grading_company : undefined,
                            grade: matchedListing ? matchedListing.grade : undefined
                        };
                    })
            }));

            setCollections(collectionsWithItems);
            setError(null);
        } catch (err: any) {
            console.error('Error loading collections:', err);
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        const supabase = createClient();
        loadCollections();

        // Re-load whenever the auth session changes. Without this, a user who
        // signs in *after* this hook mounts (the common case on cold start,
        // because auth restoration is async) never sees their collections.
        // Skip noisy events that don't change user identity (token refreshes
        // every hour would otherwise cause redundant reloads).
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
            if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return;
            loadCollections();
        });

        return () => subscription.unsubscribe();
    }, []);

    const addCollection = async (name: string, includeInPortfolio: boolean = true): Promise<string> => {
        const supabase = createClient();

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Must be signed in to create collections');

            // Ensure user profile exists (for legacy users)
            await ensureUserProfile();

            const { data, error } = await supabase
                .from('collections')
                .insert({
                    user_id: user.id,
                    name,
                    include_in_portfolio: includeInPortfolio
                })
                .select()
                .single();

            if (error) throw error;

            // Add to local state
            setCollections(prev => [...prev, {
                id: data.id,
                name: data.name,
                includeInPortfolio: data.include_in_portfolio,
                createdAt: data.created_at,
                items: []
            }]);

            return data.id; // Return the new collection ID
        } catch (err: any) {
            console.error('Error adding collection:', err);
            setError(err.message);
            throw err;
        }
    };

    const deleteCollection = async (collectionId: string) => {
        const supabase = createClient();

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Must be signed in to delete collections');

            const { error } = await supabase
                .from('collections')
                .delete()
                .eq('id', collectionId);

            if (error) throw error;

            setCollections(prev => prev.filter(c => c.id !== collectionId));
        } catch (err: any) {
            console.error('Error deleting collection:', err);
            setError(err.message);
            throw err;
        }
    };

    const updateCollection = async (collectionId: string, updates: Partial<CustomCollection>) => {
        const supabase = createClient();

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Must be signed in to update collections');

            const dbUpdates: any = {};
            if (updates.name !== undefined) dbUpdates.name = updates.name;
            if (updates.includeInPortfolio !== undefined) dbUpdates.include_in_portfolio = updates.includeInPortfolio;

            const { error } = await supabase
                .from('collections')
                .update(dbUpdates)
                .eq('id', collectionId);

            if (error) throw error;

            setCollections(prev => prev.map(c =>
                c.id === collectionId ? { ...c, ...updates } : c
            ));
        } catch (err: any) {
            console.error('Error updating collection:', err);
            setError(err.message);
            throw err;
        }
    };

    const addCardToCollection = async (
        collectionId: string,
        card: Card,
        details?: Partial<UserCollectionItem>
    ) => {
        const supabase = createClient();

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Must be signed in to add to your vault');

            // Ensure user profile exists (for legacy users)
            await ensureUserProfile();

            // Normalize on the write side too — guarantees nothing with null
            // required fields ever lands in card_data, regardless of caller.
            const safeCard = normalizeCard(card, card.id);

            const { data, error } = await supabase
                .from('collection_items')
                .insert({
                    collection_id: collectionId,
                    card_id: safeCard.id,
                    card_data: safeCard,
                    quantity: details?.quantity || 1,
                    condition: details?.condition || (safeCard.isSealed ? CardCondition.Sealed : CardCondition.NM),
                    purchase_price: details?.purchasePrice || safeCard.marketPrice || 0
                })
                .select()
                .single();

            if (error) throw error;

            // Update local state
            setCollections(prev => prev.map(col => {
                if (col.id === collectionId) {
                    return {
                        ...col,
                        items: [...col.items, {
                            id: data.id,
                            cardId: data.card_id,
                            card: normalizeCard(data.card_data, data.card_id),
                            quantity: data.quantity,
                            condition: data.condition as CardCondition,
                            purchasePrice: parseFloat(data.purchase_price),
                            addedAt: data.added_at,
                            isListing: false
                        }]
                    };
                }
                return col;
            }));
        } catch (err: any) {
            console.error('Error adding card to collection:', err);
            setError(err.message);
            throw err;
        }
    };

    const removeCardFromCollection = async (collectionId: string, itemId: string) => {
        const supabase = createClient();

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Must be signed in to remove cards');

            const { error } = await supabase
                .from('collection_items')
                .delete()
                .eq('id', itemId);

            if (error) throw error;

            setCollections(prev => prev.map(col => {
                if (col.id === collectionId) {
                    return {
                        ...col,
                        items: col.items.filter(item => item.id !== itemId)
                    };
                }
                return col;
            }));
        } catch (err: any) {
            console.error('Error removing card from collection:', err);
            setError(err.message);
            throw err;
        }
    };

    const updateCollectionItem = async (
        collectionId: string,
        itemId: string,
        updates: Partial<UserCollectionItem>
    ) => {
        const supabase = createClient();

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Must be signed in to update cards');

            const dbUpdates: any = {};
            if (updates.quantity !== undefined) dbUpdates.quantity = updates.quantity;
            if (updates.condition !== undefined) dbUpdates.condition = updates.condition;
            if (updates.purchasePrice !== undefined) dbUpdates.purchase_price = updates.purchasePrice;

            const { error } = await supabase
                .from('collection_items')
                .update(dbUpdates)
                .eq('id', itemId);

            if (error) throw error;

            setCollections(prev => prev.map(col => {
                if (col.id === collectionId) {
                    return {
                        ...col,
                        items: col.items.map(item =>
                            item.id === itemId ? { ...item, ...updates } : item
                        )
                    };
                }
                return col;
            }));
        } catch (err: any) {
            console.error('Error updating collection item:', err);
            setError(err.message);
            throw err;
        }
    };

    const refreshCollections = async () => {
        setIsLoading(true);
        await loadCollections();
    };

    return {
        collections,
        isLoading,
        error,
        addCollection,
        deleteCollection,
        updateCollection,
        addCardToCollection,
        removeCardFromCollection,
        updateCollectionItem,
        refreshCollections
    };
}
