/**
 * POST /api/admin/setup-flash-webhooks
 *
 * Registers our /api/webhooks/flash callback URL with Flash Express for all
 * five event types (status, weight, price, courier, routes). Flash's
 * production webhook is not configurable in the merchant dashboard — it's a
 * self-service API call (POST /open/v1/setting/web_hook_service) that must
 * be made once per event type.
 *
 * Auth: requires the CRON_SECRET as a bearer token, since this is a one-time
 * platform-config operation rather than a user action.
 *
 * Usage (one-time, after deploying to production):
 *
 *   curl -X POST https://cardstreet.app/api/admin/setup-flash-webhooks \
 *     -H "Authorization: Bearer $CRON_SECRET" \
 *     -H "Content-Type: application/json" \
 *     -d '{"url": "https://cardstreet.app/api/webhooks/flash"}'
 *
 * The body's `url` is optional — if omitted, defaults to the same host the
 * request came from, with `/api/webhooks/flash` appended. So calling
 * against the production deployment with no body works too.
 *
 * The response reports success/failure per event type so you can see exactly
 * which ones registered and which need a retry.
 */

import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { setWebhookService, FlashWebhookApiCode } from '@/lib/flashExpress';

const WEBHOOK_TYPES: { code: FlashWebhookApiCode; name: string }[] = [
    { code: 0, name: 'status' },
    { code: 1, name: 'weight' },
    { code: 2, name: 'price' },
    { code: 3, name: 'courier' },
    { code: 4, name: 'routes' },
];

export async function POST(req: Request) {
    // CRON_SECRET bearer-token auth
    const auth = req.headers.get('authorization') || '';
    const expected = process.env.CRON_SECRET;
    if (!expected) {
        return NextResponse.json(
            { error: 'CRON_SECRET is not configured on the server' },
            { status: 500 }
        );
    }
    if (auth !== `Bearer ${expected}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Resolve the callback URL: explicit body > derived from request host.
    let body: { url?: string } = {};
    try {
        body = await req.json();
    } catch {
        // Empty body is fine
    }

    let webhookUrl = body.url;
    if (!webhookUrl) {
        const headersList = await headers();
        const host = headersList.get('host');
        const proto = headersList.get('x-forwarded-proto') || 'https';
        if (!host) {
            return NextResponse.json(
                { error: 'Could not derive webhook URL — pass one as { url: "https://..." }' },
                { status: 400 }
            );
        }
        webhookUrl = `${proto}://${host}/api/webhooks/flash`;
    }

    if (!webhookUrl.startsWith('https://')) {
        return NextResponse.json(
            { error: 'Flash requires an HTTPS callback URL' },
            { status: 400 }
        );
    }

    // Register all five event types. Don't short-circuit on error — try each
    // and report results so the caller can see exactly which succeeded.
    const results: Array<{ code: number; name: string; status: 'success' | 'failed'; error?: string }> = [];

    for (const type of WEBHOOK_TYPES) {
        try {
            await setWebhookService({
                webhookApiCode: type.code,
                url: webhookUrl,
                enabled: true,
            });
            results.push({ code: type.code, name: type.name, status: 'success' });
        } catch (err: any) {
            results.push({
                code: type.code,
                name: type.name,
                status: 'failed',
                error: err.message || 'Unknown error',
            });
        }
    }

    const allOk = results.every(r => r.status === 'success');

    return NextResponse.json({
        success: allOk,
        webhookUrl,
        results,
    }, { status: allOk ? 200 : 207 }); // 207 Multi-Status if partial failure
}
