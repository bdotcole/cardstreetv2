import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import * as Sentry from '@sentry/nextjs';
import { syncPremiumFromRevenueCatEvent } from '@/lib/revenuecatEntitlement';

/**
 * RevenueCat webhook -- the mobile-IAP twin of the Stripe endpoints. One
 * endpoint for both stores: RevenueCat normalizes Apple/Google notifications
 * into a single event shape, so this stays a thin auth + dispatch shim over
 * lib/revenuecatEntitlement.ts.
 *
 * Auth: RevenueCat sends the Authorization header configured on the webhook
 * (Integrations -> Webhooks); it must equal REVENUECAT_WEBHOOK_SECRET verbatim
 * (the env var includes the "Bearer " prefix). Non-2xx responses make
 * RevenueCat retry with backoff, so unexpected failures return 500 on purpose.
 */

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const logPrefix = '[RevenueCatWebhook]';

  const expected = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!expected) {
    console.warn(`${logPrefix} received event but REVENUECAT_WEBHOOK_SECRET is not configured`);
    return NextResponse.json({ error: 'Webhook not configured on this deploy' }, { status: 503 });
  }

  const auth = request.headers.get('authorization') ?? '';
  const a = Buffer.from(auth);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    console.error(`${logPrefix} authorization header mismatch`);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let event: any;
  try {
    const body = await request.json();
    event = body?.event;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!event?.type) {
    return NextResponse.json({ error: 'Missing event' }, { status: 400 });
  }

  console.log(`${logPrefix} ${event.type} (${event.store ?? '?'}, ${event.environment ?? '?'}, user ${event.app_user_id ?? '?'})`);

  if (event.type === 'TEST') {
    return NextResponse.json({ received: true });
  }

  try {
    await syncPremiumFromRevenueCatEvent(event);
    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error(`${logPrefix} handler error:`, err);
    Sentry.captureException(err, { tags: { handler: 'revenuecat-webhook' }, extra: { eventType: event.type, eventId: event.id } });
    // 500 => RevenueCat retries; the writer is idempotent so replays are safe.
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
