import * as Sentry from "@sentry/nextjs";

export const sentryFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
        const response = await fetch(input, init);
        
        if (!response.ok) {
            const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
            
            if (urlStr.includes('.supabase.co')) {
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
