import { useCallback, useEffect, useRef, useState } from 'react';

// How long a request tapped while signed out stays worth resuming. Past this,
// a sign-in is its own errand and a form popping open would be a surprise.
const RESUME_WINDOW_MS = 5 * 60 * 1000;

/**
 * State for the "request a missing card" form (components/RequestCardModal),
 * shared by every search surface that offers it.
 *
 * The request is offered beside search RESULTS, not only on an empty result:
 * search is forgiving (typo, species and word fallbacks), so nearly every
 * query returns something, and a "request" button that needs zero results
 * could only be reached by typing nonsense.
 *
 * Signed out: the host's sign-in wall opens instead, and the form opens with
 * the same text once the user is signed in.
 */
export function useCardRequest(opts: {
    /** false = known signed out; undefined = not known yet (the form checks again on submit). */
    signedIn?: boolean;
    /** Opens the host's sign-in wall. */
    onRequireAuth?: () => void;
} = {}) {
    const { signedIn, onRequireAuth } = opts;
    const [query, setQuery] = useState<string | null>(null);
    const pending = useRef<{ query: string; at: number } | null>(null);

    const open = useCallback((searchText: string) => {
        if (signedIn === false && onRequireAuth) {
            pending.current = { query: searchText, at: Date.now() };
            onRequireAuth();
            return;
        }
        setQuery(searchText);
    }, [signedIn, onRequireAuth]);

    useEffect(() => {
        const waiting = pending.current;
        if (!signedIn || !waiting) return;
        pending.current = null;
        if (Date.now() - waiting.at < RESUME_WINDOW_MS) setQuery(waiting.query);
    }, [signedIn]);

    const close = useCallback(() => setQuery(null), []);

    return { open, close, isOpen: query !== null, query: query ?? '' };
}
