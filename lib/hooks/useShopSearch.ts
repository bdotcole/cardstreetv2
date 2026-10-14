'use client';

import { useEffect, useState } from 'react';
import { searchShops, type ShopSearchResult } from '@/lib/shopSearch';

/**
 * Shops whose name matches an (already debounced) search term. The latest term
 * wins: a superseded request is aborted, and a cleared box clears the list.
 */
export function useShopSearch(term: string): ShopSearchResult[] {
    const [shops, setShops] = useState<ShopSearchResult[]>([]);
    useEffect(() => {
        const controller = new AbortController();
        void searchShops(term, controller.signal).then((found) => {
            if (!controller.signal.aborted) setShops(found);
        });
        return () => controller.abort();
    }, [term]);
    return shops;
}
