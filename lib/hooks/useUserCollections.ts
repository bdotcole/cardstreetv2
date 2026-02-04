import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, UserCollectionItem, CardCondition, CustomCollection } from '@/types';
import { ensureUserProfile } from '@/lib/utils/ensureUserProfile';

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

            // Group items by collection
            const collectionsWithItems: CustomCollection[] = (collectionsData || []).map(col => ({
                id: col.id,
                name: col.name,
                includeInPortfolio: col.include_in_portfolio,
                createdAt: col.created_at,
                items: (itemsData || [])
                    .filter(item => item.collection_id === col.id)
                    .map(item => ({
                        id: item.id,
                        cardId: item.card_id,
                        card: item.card_data as Card,
                        quantity: item.quantity,
                        condition: item.condition as CardCondition,
                        purchasePrice: parseFloat(item.purchase_price || '0'),
                        addedAt: item.added_at,
                        isListing: false, // Will be determined by checking listings table
                        listingPrice: undefined,
                        isGraded: false,
                        gradingCompany: undefined,
                        grade: undefined
                    }))
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
        loadCollections();
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
            // Ensure user profile exists (for legacy users)
            await ensureUserProfile();

            const { data, error } = await supabase
                .from('collection_items')
                .insert({
                    collection_id: collectionId,
                    card_id: card.id,
                    card_data: card,
                    quantity: details?.quantity || 1,
                    condition: details?.condition || CardCondition.NM,
                    purchase_price: details?.purchasePrice || card.marketPrice || 0
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
                            card: data.card_data as Card,
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
