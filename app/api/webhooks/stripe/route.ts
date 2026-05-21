/**
 * Stripe Webhook Handler — US platform.
 *
 * Receives webhooks from the US Stripe platform and verifies them against
 * STRIPE_WEBHOOK_SECRET. The shared handler does the heavy lifting; this
 * route just binds the region. The TH platform has its own endpoint at
 * /api/webhooks/stripe/th.
 */

import { NextRequest } from 'next/server';
import { handleStripeWebhook } from '@/lib/stripeWebhook';

export async function POST(request: NextRequest) {
    return handleStripeWebhook(request, 'us');
}
