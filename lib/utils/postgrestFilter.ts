/**
 * Sanitizers for values interpolated into PostgREST filter strings.
 *
 * PostgREST's `.or()` takes ONE string holding a comma-separated list of
 * `column.operator.value` predicates, so a raw user search term is parsed as
 * filter syntax, not as data. A term containing a comma splits the list and
 * the query dies with "failed to parse logic tree" — an ordinary search like
 * "pikachu, charizard" 500s the endpoint. Parentheses and `%` corrupt the
 * pattern the same way.
 *
 * Escaping is not an option: PostgREST has no escape syntax inside the or()
 * grammar, so the delimiters have to go. They are replaced with spaces rather
 * than deleted so "pikachu,charizard" degrades to a two-word contains-match
 * instead of silently becoming the single token "pikachucharizard".
 */

/** PostgREST or() delimiters plus the LIKE wildcard. */
const OR_FILTER_DELIMITERS = /[,()%]/g;

/**
 * Make a user-supplied term safe to interpolate into an `.or()` predicate.
 * Returns '' when nothing searchable survives — callers should skip the
 * filter entirely rather than match on an empty pattern.
 */
export function sanitizeOrFilterTerm(term: string): string {
    return term.replace(OR_FILTER_DELIMITERS, ' ').trim();
}
