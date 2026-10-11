'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { getLoadedSearchDictionary, loadSearchDictionary, type SearchDictionary } from '@/lib/search/dictionary';
import { resolveForFilter } from '@/lib/search/resolve';
import type { Resolution } from '@/lib/search/types';

/**
 * The species a filter box's text names, for client-side filters (vault,
 * desktop collection). Exact names only, never typo guesses: a filter that
 * silently shows a different Pokémon reads as broken.
 *
 * The query is deferred so typing stays responsive on large collections, and
 * the dictionary is only downloaded once the user actually types. Until it
 * arrives this returns null and callers fall back to literal matching.
 */
export function useSearchResolution(query: string): Resolution | null {
    const deferred = useDeferredValue(query);
    const [dict, setDict] = useState<SearchDictionary | null>(() => getLoadedSearchDictionary());
    const wanted = !dict && (deferred || '').trim().length >= 2;

    useEffect(() => {
        if (!wanted) return;
        let alive = true;
        // No timeout race here: nothing waits on it, the filter just gets
        // smarter once the chunk has arrived. Re-run per query so a failed
        // download is retried (loadSearchDictionary rate-limits retries).
        loadSearchDictionary(0).then((d) => {
            if (alive && d) setDict(d);
        });
        return () => {
            alive = false;
        };
    }, [wanted, deferred]);

    return useMemo(() => {
        const q = (deferred || '').trim();
        if (!dict || q.length < 2) return null;
        return resolveForFilter(dict, q);
    }, [dict, deferred]);
}
