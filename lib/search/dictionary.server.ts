import 'server-only';
import data from './data/pokemonNames.json';
import { buildSearchDictionary, type SearchDictionary } from './dictionary';
import type { SearchDictionaryFile } from './types';

/**
 * The search dictionary for server routes (app/api/**), imported statically:
 * on the server there is no bundle to keep small and no reason to wait.
 *
 * Only server code may import this module. Everything shared with the client
 * takes the dictionary as a parameter and gets it there through the dynamic
 * import in dictionary.ts; a static import of the JSON reachable from a client
 * module would put the whole file in the main bundle of every page.
 */

let memo: SearchDictionary | null = null;

export function getServerSearchDictionary(): SearchDictionary {
    if (memo) return memo;
    try {
        memo = buildSearchDictionary(data as unknown as SearchDictionaryFile);
    } catch (err) {
        // An unreadable file must degrade search to literal matching, never
        // fail the route that asked.
        console.error('[search] server dictionary build failed:', err);
        memo = { groups: [], keys: [], exact: new Map(), late: new Map() };
    }
    return memo;
}
