import * as Sentry from "@sentry/nextjs";

// Supabase's GoTrue auth endpoints (/auth/v1/*) use 4xx responses as ordinary
// control flow rather than as faults: a wrong password (400 invalid_credentials),
// an expired/rotated/revoked refresh token (400), an expired access token (401),
// a weak password at signup (422 weak_password), an unconfirmed email, and an
// already-registered user are all expected, user-driven outcomes. Reporting them
// as Sentry exceptions only creates alert noise that buries genuine errors, so we
// skip capture for them. Anything still worth seeing — 403 (e.g. signups disabled),
// 404, 429 (rate limiting / abuse), and all 5xx — continues to report, as do
// non-auth responses (e.g. PostgREST 401s, which can signal RLS issues).
const isExpectedAuthControlFlow = (urlStr: string, status: number): boolean =>
    urlStr.includes('/auth/v1/') && (status === 400 || status === 401 || status === 422);

export const sentryFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
        const response = await fetch(input, init);
        
        if (!response.ok) {
            const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
            
            if (urlStr.includes('.supabase.co') && !isExpectedAuthControlFlow(urlStr, response.status)) {
                const clonedResp = response.clone();
                try {
                    const errorData = await clonedResp.json();
                    
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
        if (urlStr.includes('.supabase.co')) {
            Sentry.captureException(error, {
                extra: { url: urlStr, message: 'Network connectivity failure to Supabase' },
                tags: { database_client: 'supabase' }
            });
        }
        throw error;
    }
};
