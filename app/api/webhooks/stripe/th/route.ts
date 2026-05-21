/**
 * Stripe Webhook Handler — TH platform.
 *
 * Receives webhooks from the Stripe Thailand platform and verifies them
 * against STRIPE_WEBHOOK_SECRET_TH. The shared handler does the heavy
 * lifting; this route just binds the region. The US platform has its own
 * endpoint at /api/webhooks/stripe.
 *
 * Configure the TH Stripe Dashboard webhook to POST here. Each Stripe
 * account signs with its own secret, so the two endpoints can't be merged
 * into one — Stripe doesn't put the originating platform in the request.
 */

import { NextRequest } from 'next/server';
import { handleStripeWebhook } from '@/lib/stripeWebhook';

export async function POST(request: NextRequest) {
    return handleStripeWebhook(request, 'th');
}
