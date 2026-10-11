import * as Sentry from "@sentry/nextjs";

// Supabase's GoTrue auth endpoints (/auth/v1/*) use 4xx responses as ordinary
// control flow rather than as faults: a wrong password (400 invalid_credentials),
// an expired/rotated/revoked refresh token (400), an expired access token (401),
// a weak password at signup (422 weak_password), an unconfirmed email, and an
// already-registered user are all expected, user-driven outcomes. Reporting them
// as Sentry exceptions only creates alert noise that buries genuine errors, so we
// skip capture for them. Anything still worth seeing — most 403s (e.g. signups
// disabled), 404, 429 (rate limiting / abuse), and all 5xx — continues to
// report, as do non-auth responses (e.g. PostgREST 401s, which can signal RLS
// issues).
//
// Logout is the one auth call where 403/404 also mean nothing: signing out a
// user who no longer exists (account deletion signs out after deleteUser) gets
// 403 user_not_found, and auth-js itself ignores 401/403/404 from logout and
// clears the session anyway (CARDSTREET-2M).
const isExpectedAuthControlFlow = (urlStr: string, status: number): boolean =>
    urlStr.includes('/auth/v1/') && (
        status === 400 || status === 401 || status === 422
        || (urlStr.includes('/auth/v1/logout') && (status === 403 || status === 404))
    );

// GoTrue's per-address cooldown on emailed links: asking for a second reset or
// confirmation email within the window answers 429 "For security purposes, you
// can only request this after N seconds." That is the user tapping twice, and
// the form shows the message (CARDSTREET-23). Scoped by message so the
// project-wide email quota (429 over_email_send_rate_limit, "email rate limit
// exceeded"), which means emails are failing for everyone, still reports.
const isAuthEmailCooldown = (urlStr: string, status: number, body: unknown): boolean => {
    if (!urlStr.includes('/auth/v1/') || status !== 429) return false;
    const message = String((body as { message?: unknown } | null)?.message ?? '').toLowerCase();
    return message.startsWith('for security purposes, you can only request this after');
};

// GoTrue returns 403 when a one-time email link (signup confirm / password
// recovery / magic link) has already been consumed or expired — most often
// because a mail provider's link scanner GETs it before the human clicks (see
// the auth email-link prefetch notes in CLAUDE.md). That is expected control
// flow, not a fault, and was surfacing as fake "Supabase API Error: [403]"
// issues. Scoped by message so a genuine auth 403 (e.g. signups disabled) is
// unaffected. Needs the parsed body, so it runs after the response is read.
const isConsumedAuthLink = (urlStr: string, status: number, body: unknown): boolean => {
    if (!urlStr.includes('/auth/v1/') || status !== 403) return false;
    const b = (body ?? {}) as { message?: unknown; error_code?: unknown; code?: unknown };
    const message = String(b.message ?? '').toLowerCase();
    const code = String(b.error_code ?? b.code ?? '').toLowerCase();
    return code === 'otp_expired' || message.includes('link is invalid or has expired');
};

// A fetch that throws while the device reports itself offline is the user's
// connectivity, not a fault on our side or Supabase's — a lost signal on the
// BTS, a tunnel, a backgrounded Capacitor app. The browsers spell the same
// failure differently ("Failed to fetch" on Blink, "Load failed" on WebKit),
// so it arrived as several separate Sentry issues with nothing actionable in
// any of them. Everything else still reports: a throw while ONLINE can mean
// Supabase is genuinely unreachable, DNS is broken, or CORS regressed, which
// is exactly the signal this capture was added for. navigator.onLine only
// promises a false means offline (a true is unreliable), which is the
// direction we depend on here.
const isClientOffline = (): boolean =>
    typeof navigator !== 'undefined' && navigator.onLine === false;

// Ordinary "no such row / no such object" answers, not faults. PostgREST returns
// 406 (PGRST116) when .single() finds zero rows, which several profile and
// listing lookups do on purpose on every page load, and Storage returns 404 for
// an image that was never uploaded. These were three of the Sentry envelopes on
// a cold homepage load and buried real errors under quota noise.
const isExpectedDataMiss = (url: string, status: number): boolean =>
    (url.includes('/rest/v1/') && status === 406) ||
    (url.includes('/storage/v1/') && (status === 404 || status === 400));

// Catalog search calls the pg_trgm typo RPC, which ships in an optional
// migration (20261003_search_trigram_fuzzy.sql). Until it is applied PostgREST
// answers 404 PGRST202 ("function not in the schema cache") and searchCards
// stops calling it for the session; that one expected miss per session must
// not become a Sentry issue with a session replay attached. Scoped to exactly
// this function and code, so a missing RPC anywhere else still reports.
const isMissingOptionalSearchRpc = (urlStr: string, status: number, body: unknown): boolean => {
    if (status !== 404 || !urlStr.includes('/rest/v1/rpc/search_cards_fuzzy_v2')) return false;
    const b = (body ?? {}) as { code?: unknown };
    return String(b.code ?? '') === 'PGRST202';
};

// A cancelled request is the caller's choice, not a failure: search boxes
// abort the previous query's fetches on every keystroke. Reading the error
// name covers every browser; the signal check covers a body read cut short.
const isAbort = (error: unknown, init?: RequestInit, input?: RequestInfo | URL): boolean =>
    (error as { name?: unknown } | null)?.name === 'AbortError'
    || !!init?.signal?.aborted
    || (typeof Request !== 'undefined' && input instanceof Request && input.signal?.aborted === true);

export const sentryFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
        const response = await fetch(input, init);
        
        if (!response.ok) {
            const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
            
            if (urlStr.includes('.supabase.co') && !isExpectedAuthControlFlow(urlStr, response.status) && !isExpectedDataMiss(urlStr, response.status)) {
                const clonedResp = response.clone();
                try {
                    const errorData = await clonedResp.json();

                    if (isConsumedAuthLink(urlStr, response.status, errorData)
                        || isAuthEmailCooldown(urlStr, response.status, errorData)
                        || isMissingOptionalSearchRpc(urlStr, response.status, errorData)) {
                        return response;
                    }

                    let parsedBody = undefined;
                    try {
                        if (init?.body && typeof init.body === 'string') {
                            parsedBody = JSON.parse(init.body);
                        }
                    } catch (e) { /* ignore body parse errors */ }

                    Sentry.captureException(new Error(`Supabase API Error: [${response.status}] ${errorData?.message || response.statusText}`), {
                        extra: {
                            url: urlStr,
                            status: response.status,
                            supabaseError: errorData,
                            requestBody: parsedBody,
                            method: init?.method || 'GET'
                        },
                        tags: {
                            database_client: 'supabase'
                        }
                    });
                } catch (jsonErr) {
                    if (!isAbort(jsonErr, init, input)) {
                        Sentry.captureException(new Error(`Supabase API Error: [${response.status}] ${response.statusText}`), {
                            extra: { url: urlStr }
                        });
                    }
                }
            }
        }
        return response;
    } catch (error) {
        const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (urlStr.includes('.supabase.co') && !isClientOffline() && !isAbort(error, init, input)) {
            // One issue per side, not one per call site: grouped by stack, these
            // were ten separate "Failed to fetch" / "Load failed" issues of a few
            // events each, none actionable alone. A real outage still shows as a
            // spike in the grouped issue.
            Sentry.captureException(error, {
                level: 'warning',
                fingerprint: ['supabase-network-failure', typeof window === 'undefined' ? 'server' : 'client'],
                extra: { url: urlStr, message: 'Network connectivity failure to Supabase' },
                tags: { database_client: 'supabase' }
            });
        }
        throw error;
    }
};
