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
const isExpectedAuthControlFlow = (urlStr: string, status: number): boolean =>
    urlStr.includes('/auth/v1/') && (status === 400 || status === 401 || status === 422);

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

export const sentryFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
        const response = await fetch(input, init);
        
        if (!response.ok) {
            const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
            
            if (urlStr.includes('.supabase.co') && !isExpectedAuthControlFlow(urlStr, response.status)) {
                const clonedResp = response.clone();
                try {
                    const errorData = await clonedResp.json();

                    if (isConsumedAuthLink(urlStr, response.status, errorData)) {
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
                    Sentry.captureException(new Error(`Supabase API Error: [${response.status}] ${response.statusText}`), {
                        extra: { url: urlStr }
                    });
                }
            }
        }
        return response;
    } catch (error) {
        const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (urlStr.includes('.supabase.co') && !isClientOffline()) {
            Sentry.captureException(error, {
                extra: { url: urlStr, message: 'Network connectivity failure to Supabase' },
                tags: { database_client: 'supabase' }
            });
        }
        throw error;
    }
};
