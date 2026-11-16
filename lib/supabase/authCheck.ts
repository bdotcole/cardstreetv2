import { isAuthApiError, isAuthRetryableFetchError, isAuthSessionMissingError } from '@supabase/supabase-js';

/**
 * `supabase.auth.getUser()` came back with no user. Was that an answer
 * ("nobody is signed in") or a failure to ask?
 *
 * auth-js does not throw when it cannot reach the auth server: it returns
 * `{ data: { user: null }, error }`, the same shape as a missing session.
 * Reading every null user as "signed out" emptied the Vault whenever it
 * reloaded with no connection. That is not rare: auth-js fires SIGNED_IN, and
 * so a Vault reload, each time the app comes back to the foreground with a
 * session that has not expired, which is the moment a phone's connection is
 * least likely to be up.
 *
 * True means the check could not be made, so the caller should keep what it
 * has. A real sign-out still reads false: it arrives as a missing session, or
 * as a 4xx in which the auth server rejects the token. auth-js draws the same
 * line when a token refresh fails (it keeps the session on a retryable error).
 */
export function authCheckUnavailable(error: unknown): boolean {
    if (!error) return false;
    if (isAuthSessionMissingError(error)) return false;
    // No connection (status 0), or the auth server answered 502/503/504.
    if (isAuthRetryableFetchError(error)) return true;
    // A 4xx is the server's verdict on this token; a 5xx or a rate limit is not.
    if (isAuthApiError(error)) return error.status >= 500 || error.status === 429;
    // Anything else (a reply that could not be parsed) is not a verdict either.
    return true;
}
