import CourierClient from "@trycourier/courier";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Lazy-initialized Courier client. We can't construct at module load because
// any importing route would crash during `next build` page-data collection if
// COURIER_AUTH_TOKEN isn't present in the build environment. Same reasoning
// for the Supabase admin client below.
let _courier: InstanceType<typeof CourierClient> | null | undefined;
function getCourier() {
    if (_courier !== undefined) return _courier;
    const token = (process.env.COURIER_AUTH_TOKEN || "").trim();
    if (!token) {
        console.warn('[Courier] ⚠️  COURIER_AUTH_TOKEN is not set — all notification sends will be skipped.');
        _courier = null;
    } else {
        _courier = new CourierClient({ apiKey: token });
    }
    return _courier;
}

let _supabaseAdmin: SupabaseClient | null = null;
function getSupabaseAdmin(): SupabaseClient {
    if (_supabaseAdmin) return _supabaseAdmin;
    _supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    return _supabaseAdmin;
}

/**
 * Courier template IDs for transactional notifications.
 *
 * Each send below references a template by ID and passes only merge `data` —
 * never inline `content`. The subject, email body, AND per-channel push copy
 * are authored in the Courier dashboard, not hardcoded here. Passing `content`
 * instead bypasses these templates entirely (Courier auto-generates a plain
 * email from the title/body) — that was the original bug: every template read
 * "Sent: 0" while plain fallback emails went out through Postmark.
 *
 * IDs default to the live Production templates and can be overridden per
 * environment via env (e.g. to aim a preview deploy at a draft template).
 */
const TEMPLATES = {
    // IDs must match what each template's own Send tab prescribes (Content ->
    // Templates -> <template> -> Send). The previous UUID-style ids here did
    // not — Courier's snippets use the base32 content-template ids below, and
    // the dashboard logs showed zero template sends ever succeeding, so treat
    // any UUID-looking id in this table as wrong.
    sold: (process.env.COURIER_SOLD_TEMPLATE_ID || 'BATFJT2XTH4YAHJNK96A3MG762DQ').trim(),
    labelGenerated: (process.env.COURIER_LABEL_GENERATED_TEMPLATE_ID || '000AHF66DDMCJVMGZJK5P8Q2824Z').trim(),
    shipped: (process.env.COURIER_SHIPPED_TEMPLATE_ID || 'PN39K94HQS47C4GTEGVSDD7GFMPR').trim(),
    orderConfirmed: (process.env.COURIER_ORDER_CONFIRMED_TEMPLATE_ID || 'WAE55N73MYM5CAGN7GTWQT7XPN8B').trim(),
    firstTimeSale: (process.env.COURIER_FIRST_TIME_SALE_TEMPLATE_ID || 'nt_01kvba0yzweh78ef8f9c1b49z7').trim(),
    // OBO Best-Offer templates. No default id yet — these dashboard templates
    // are ops/founder action before go-live. When the env id is empty the send
    // functions fall back to inline bilingual `content` (like
    // sendWishlistListingAlert), so the dark->live flip doesn't have to wait on
    // the dashboard work. Take the id from each template's own Send tab
    // (base32), NOT a UUID (see the warning above).
    offerReceived: (process.env.COURIER_OFFER_RECEIVED_TEMPLATE_ID || '').trim(),
    offerAccepted: (process.env.COURIER_OFFER_ACCEPTED_TEMPLATE_ID || '').trim(),
    offerRejected: (process.env.COURIER_OFFER_REJECTED_TEMPLATE_ID || '').trim(),
    offerCountered: (process.env.COURIER_OFFER_COUNTERED_TEMPLATE_ID || '').trim(),
    offerExpired: (process.env.COURIER_OFFER_EXPIRED_TEMPLATE_ID || '').trim(),
} as const;

/**
 * Helper to fetch a user's notification preferences AND email in one call.
 */
async function getUserNotifContext(userId: string): Promise<{
    email: string | null;
    fcmToken: string | null;
    prefs: Record<string, boolean>;
}> {
    const supabaseAdmin = getSupabaseAdmin();
    // Fetch email from auth
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.admin.getUserById(userId);
    const email = (!authErr && user?.email) ? user.email : null;

    // Fetch prefs + FCM token
    const { data: prefs } = await supabaseAdmin
        .from('notification_preferences')
        .select('*')
        .eq('user_id', userId)
        .single();

    const defaults = {
        sold_email: true, sold_push: true,
        label_email: true, label_push: true,
        shipped_email: true, shipped_push: true,
        // OBO Best-Offer prefs. A user whose prefs row predates the
        // 20260707_offer_notification_prefs migration (or has no row) still gets
        // defaults. The migration is NOT NULL DEFAULT true, so a spread of the
        // real row never overrides these with a NULL.
        offer_email: true, offer_push: true,
        offer_accepted_email: true, offer_accepted_push: true,
        offer_rejected_email: true, offer_rejected_push: true,
        offer_countered_email: true, offer_countered_push: true,
        offer_expired_email: true, offer_expired_push: true,
    };

    return {
        email,
        fcmToken: prefs?.fcm_token || null,
        prefs: prefs ? { ...defaults, ...prefs } : defaults,
    };
}

/**
 * Build Courier recipient object. Supports email and/or Firebase push.
 */
function buildRecipient(email: string | null, fcmToken: string | null) {
    const recipient: any = {};
    if (email) recipient.email = email;
    // Courier FCM push requires the token in the `data` field as `firebaseToken`
    if (fcmToken) recipient.firebaseToken = fcmToken;
    return recipient;
}

/**
 * Build the routing config based on user prefs.
 */
function buildRouting(wantEmail: boolean, wantPush: boolean) {
    const channels: string[] = [];
    if (wantEmail) channels.push("email");
    if (wantPush) channels.push("push");
    return { method: "all" as const, channels };
}

/**
 * Notifies the seller when their item is sold.
 */
export async function sendSoldNotification(sellerId: string, orderDetails: any) {
    const courier = getCourier();
    if (!courier) { console.warn('[Courier] Client not initialized — skipping sold notification'); return; }
    const { email, fcmToken, prefs } = await getUserNotifContext(sellerId);
    if (!prefs.sold_email && !prefs.sold_push) return;
    if (!email && !fcmToken) {
        console.warn(`[Courier] No email or FCM token for seller ${sellerId} — skipping sold notification`);
        return;
    }

    const recipient = buildRecipient(
        prefs.sold_email ? email : null,
        prefs.sold_push ? fcmToken : null
    );
    const routing = buildRouting(!!prefs.sold_email && !!email, !!prefs.sold_push && !!fcmToken);
    if (routing.channels.length === 0) return;

    try {
        console.log(`[Courier] Sending 'Sold' notification to recipient:`, JSON.stringify(recipient));
        // Courier SDK v7 returns `requestId`, not `messageId`. Either way we
        // only need to log it for support traceability.
        const sendResult = await courier.send.message({
            message: {
                to: recipient,
                template: TEMPLATES.sold,
                routing,
                data: {
                    // Template references {orderDetails.total_amount} (and {orderDetails.id}).
                    // Pass only the fields the template reads, not the whole order row.
                    orderDetails: { id: orderDetails.id, total_amount: orderDetails.total_amount },
                    // Push deep-link payload (read by the mobile FCM handler).
                    orderId: orderDetails.id,
                    type: 'sold',
                },
            }
        });
        console.log(`[Courier] ✅ 'Sold' notification sent. Request ID: ${(sendResult as { requestId?: string }).requestId}`);
    } catch (error) {
        console.error(`[Courier] ❌ Error sending 'Sold' notification to ${sellerId}:`, error);
    }
}

/**
 * Notifies the seller that a shipping label is ready.
 *
 * When `labelPdfBase64` is provided, the PDF is attached to the email via a
 * Postmark provider override — Courier's project here is configured against
 * Postmark, whose attachment schema is { Name, Content, ContentType } inside
 * an `Attachments` array. The email body always links to the seller's
 * CardStreet dashboard as a backup so the message is useful even if the
 * recipient's mail client strips the attachment (or for the push channel
 * where attachments don't apply).
 */
export async function sendLabelGeneratedNotification(
    sellerId: string,
    orderDetails: { id: string },
    labelPdfBase64?: string | null,
) {
    const courier = getCourier();
    if (!courier) { console.warn('[Courier] Client not initialized — skipping label notification'); return; }
    const { email, fcmToken, prefs } = await getUserNotifContext(sellerId);
    if (!prefs.label_email && !prefs.label_push) return;
    if (!email && !fcmToken) {
        console.warn(`[Courier] No email or FCM token for seller ${sellerId} — skipping label notification`);
        return;
    }

    const recipient = buildRecipient(
        prefs.label_email ? email : null,
        prefs.label_push ? fcmToken : null
    );
    const routing = buildRouting(!!prefs.label_email && !!email, !!prefs.label_push && !!fcmToken);
    if (routing.channels.length === 0) return;

    const orderUrl = `${appBaseUrl()}/orders/${orderDetails.id}`;
    const hasAttachment = !!labelPdfBase64;

    // Postmark attachment goes through Courier's per-provider override. The
    // override body is merged into Postmark's email API request, so any
    // standard Postmark field (Attachments included) is accepted there.
    const providers = hasAttachment
        ? {
              postmark: {
                  override: {
                      body: {
                          Attachments: [
                              {
                                  Name: `cardstreet-label-${orderDetails.id}.pdf`,
                                  Content: labelPdfBase64,
                                  ContentType: 'application/pdf',
                              },
                          ],
                      },
                  },
              },
          }
        : undefined;

    try {
        console.log(`[Courier] Sending 'Label Generated' notification to recipient:`, JSON.stringify(recipient), `(attachment: ${hasAttachment ? 'yes' : 'no'})`);
        const { requestId } = await courier.send.message({
            message: {
                to: recipient,
                template: TEMPLATES.labelGenerated,
                routing,
                ...(providers ? { providers } : {}),
                data: {
                    // Template references {orderDetails.id} and {labelUrl}. The label
                    // route requires auth, so deep-link to the order page where the
                    // seller can pull the label (the PDF is also attached to this
                    // email via the Postmark override below).
                    orderDetails: { id: orderDetails.id },
                    labelUrl: orderUrl,
                    // Push deep-link payload.
                    orderId: orderDetails.id,
                    type: 'label_generated',
                },
            },
        });
        console.log(`[Courier] ✅ 'Label Generated' notification sent. Request ID: ${requestId}`);
    } catch (error) {
        console.error(`[Courier] ❌ Error sending 'Label Generated' notification to ${sellerId}:`, error);
    }
}

/**
 * Notifies the buyer that their item has shipped.
 */
export async function sendShippedNotification(buyerId: string, orderDetails: any, trackingUrl: string) {
    const courier = getCourier();
    if (!courier) { console.warn('[Courier] Client not initialized — skipping shipped notification'); return; }
    const { email, fcmToken, prefs } = await getUserNotifContext(buyerId);
    if (!prefs.shipped_email && !prefs.shipped_push) return;
    if (!email && !fcmToken) {
        console.warn(`[Courier] No email or FCM token for buyer ${buyerId} — skipping shipped notification`);
        return;
    }

    const recipient = buildRecipient(
        prefs.shipped_email ? email : null,
        prefs.shipped_push ? fcmToken : null
    );
    const routing = buildRouting(!!prefs.shipped_email && !!email, !!prefs.shipped_push && !!fcmToken);
    if (routing.channels.length === 0) return;

    const trackingLink = `https://www.flashexpress.com/fle/tracking?se=${trackingUrl}`;
    try {
        await courier.send.message({
            message: {
                to: recipient,
                template: TEMPLATES.shipped,
                routing,
                data: {
                    // Template references {trackingLink} (full URL) + {orderDetails.id}.
                    orderDetails: { id: orderDetails.id },
                    trackingLink,
                    trackingNumber: trackingUrl,
                    // Push deep-link payload (unchanged contract: raw tracking number).
                    orderId: orderDetails.id,
                    type: 'shipped',
                    trackingUrl,
                },
            }
        });
        console.log(`[Courier] ✅ 'Shipped' notification sent to buyer ${buyerId}`);
    } catch (error) {
        console.error(`[Courier] ❌ Error sending 'Shipped' notification to ${buyerId}:`, error);
    }
}

/**
 * Notifies the buyer that their order was confirmed, with tracking info.
 */
export async function sendOrderConfirmationNotification(buyerId: string, orderDetails: any, trackingNumbers: string[] = []) {
    const courier = getCourier();
    if (!courier) { console.warn('[Courier] Client not initialized — skipping order confirmation'); return; }
    const { email, fcmToken, prefs } = await getUserNotifContext(buyerId);
    // Order confirmations are transactional receipts — buyers should always get
    // them unless they've explicitly opted out. Use a dedicated preference pair
    // (`confirmation_email` / `confirmation_push`) instead of `shipped_*`, so
    // muting shipping-update spam doesn't also silence the receipt.
    // Default is opt-in: `!== false` treats undefined/missing as opted-in,
    // matching the convention used by `payout_*` and `delivered_*` below.
    const wantEmail = prefs.confirmation_email !== false;
    const wantPush = prefs.confirmation_push !== false;
    if (!wantEmail && !wantPush) return;
    if (!email && !fcmToken) {
        console.warn(`[Courier] No email or FCM token for buyer ${buyerId} — skipping order confirmation`);
        return;
    }

    const recipient = buildRecipient(
        wantEmail ? email : null,
        wantPush ? fcmToken : null
    );
    const routing = buildRouting(!!wantEmail && !!email, !!wantPush && !!fcmToken);
    if (routing.channels.length === 0) return;

    try {
        await courier.send.message({
            message: {
                to: recipient,
                template: TEMPLATES.orderConfirmed,
                routing,
                data: {
                    // Template references {orderDetails.total_amount} + {trackingNumbersText}.
                    orderDetails: { id: orderDetails.id, total_amount: orderDetails.total_amount },
                    trackingNumbersText: trackingNumbers.join(', '),
                    hasTracking: trackingNumbers.length > 0,
                    // Push deep-link payload (unchanged contract: array form).
                    orderId: orderDetails.id,
                    type: 'order_confirmation',
                    trackingNumbers,
                },
            }
        });
        console.log(`[Courier] ✅ 'Order Confirmation' notification sent to buyer ${buyerId}`);
    } catch (error) {
        console.error(`[Courier] ❌ Error sending 'Order Confirmation' notification to ${buyerId}:`, error);
    }
}

/**
 * Notifies the seller that the buyer completed and confirmed receipt of their order.
 */
export async function sendPurchaseCompletedNotification(sellerId: string, orderDetails: any) {
    const courier = getCourier();
    if (!courier) { console.warn('[Courier] Client not initialized — skipping purchase completed notification'); return; }
    const { email, fcmToken, prefs } = await getUserNotifContext(sellerId);
    if (!prefs.sold_email && !prefs.sold_push) return;
    if (!email && !fcmToken) {
        console.warn(`[Courier] No email or FCM token for seller ${sellerId} — skipping purchase completed notification`);
        return;
    }

    const recipient = buildRecipient(
        prefs.sold_email ? email : null,
        prefs.sold_push ? fcmToken : null
    );
    const routing = buildRouting(!!prefs.sold_email && !!email, !!prefs.sold_push && !!fcmToken);
    if (routing.channels.length === 0) return;

    try {
        await courier.send.message({
            message: {
                to: recipient,
                content: {
                    title: "CardStreet: Purchase Completed! 💰",
                    body: `The buyer has confirmed receipt of order ${orderDetails.id}. Your funds are being released to your account!`,
                },
                routing,
                data: { orderId: orderDetails.id, type: 'purchase_completed' }
            }
        });
        console.log(`[Courier] ✅ 'Purchase Completed' notification sent to seller ${sellerId}`);
    } catch (error) {
        console.error(`[Courier] ❌ Error sending 'Purchase Completed' notification to ${sellerId}:`, error);
    }
}

/**
 * Notifies the seller that their payout transfer has been initiated via Stripe.
 */
export async function sendPayoutCompletedNotification(sellerId: string, orderId: string, amount: number) {
    const courier = getCourier();
    if (!courier) { console.warn('[Courier] Client not initialized — skipping payout notification'); return; }
    const { email, fcmToken, prefs } = await getUserNotifContext(sellerId);
    
    // Default to true if not explicitly set in the preferences
    const wantEmail = prefs.payout_email !== false;
    const wantPush = prefs.payout_push !== false;
    
    if (!wantEmail && !wantPush) return;
    if (!email && !fcmToken) {
        console.warn(`[Courier] No email or FCM token for seller ${sellerId} — skipping payout completed notification`);
        return;
    }

    const recipient = buildRecipient(
        wantEmail ? email : null,
        wantPush ? fcmToken : null
    );
    const routing = buildRouting(!!wantEmail && !!email, !!wantPush && !!fcmToken);
    if (routing.channels.length === 0) return;

    try {
        await courier.send.message({
            message: {
                to: recipient,
                content: {
                    title: "CardStreet: Payout Sent! 💸",
                    body: `Your payout of ฿${amount.toLocaleString()} for order ${orderId} has been successfully transferred to your Stripe account.`,
                },
                routing,
                data: { orderId, type: 'payout_completed', amount }
            }
        });
        console.log(`[Courier] ✅ 'Payout Completed' notification sent to seller ${sellerId}`);
    } catch (error) {
        console.error(`[Courier] ❌ Error sending 'Payout Completed' notification to ${sellerId}:`, error);
    }
}

/**
 * Notifies the buyer that their package has been delivered by Flash Express.
 */
export async function sendPackageDeliveredNotification(buyerId: string, orderId: string, trackingNumber: string) {
    const courier = getCourier();
    if (!courier) { console.warn('[Courier] Client not initialized — skipping package delivered notification'); return; }
    const { email, fcmToken, prefs } = await getUserNotifContext(buyerId);
    
    // Default to true if not explicitly set in the preferences
    const wantEmail = prefs.delivered_email !== false;
    const wantPush = prefs.delivered_push !== false;
    
    if (!wantEmail && !wantPush) return;
    if (!email && !fcmToken) {
        console.warn(`[Courier] No email or FCM token for buyer ${buyerId} — skipping package delivered notification`);
        return;
    }

    const recipient = buildRecipient(
        wantEmail ? email : null,
        wantPush ? fcmToken : null
    );
    const routing = buildRouting(!!wantEmail && !!email, !!wantPush && !!fcmToken);
    if (routing.channels.length === 0) return;

    try {
        await courier.send.message({
            message: {
                to: recipient,
                content: {
                    title: "CardStreet: Package Delivered! 📦",
                    body: `Your Flash Express package (${trackingNumber}) for order ${orderId} has been delivered. Please confirm receipt in the app to release funds to the seller.`,
                },
                routing,
                data: { orderId, type: 'package_delivered', trackingNumber }
            }
        });
        console.log(`[Courier] ✅ 'Package Delivered' notification sent to buyer ${buyerId}`);
    } catch (error) {
        console.error(`[Courier] ❌ Error sending 'Package Delivered' notification to ${buyerId}:`, error);
    }
}

/**
 * Notifies a user that a card they requested (which was missing from the
 * catalog) has now been added and is searchable. Fired when a card_request
 * transitions to status 'Added'.
 *
 * Opt-in by default (`card_request_email`/`card_request_push` !== false),
 * matching the convention used by the payout/delivered notifications above.
 * Never throws — a notification failure must not block the admin's add flow.
 */
export async function sendCardRequestFulfilledNotification(
    requesterId: string,
    details: { searchQuery: string; note?: string | null },
) {
    const courier = getCourier();
    if (!courier) { console.warn('[Courier] Client not initialized — skipping card-request notification'); return; }
    const { email, fcmToken, prefs } = await getUserNotifContext(requesterId);

    const wantEmail = prefs.card_request_email !== false;
    const wantPush = prefs.card_request_push !== false;
    if (!wantEmail && !wantPush) return;
    if (!email && !fcmToken) {
        console.warn(`[Courier] No email or FCM token for requester ${requesterId} — skipping card-request notification`);
        return;
    }

    const recipient = buildRecipient(
        wantEmail ? email : null,
        wantPush ? fcmToken : null,
    );
    const routing = buildRouting(!!wantEmail && !!email, !!wantPush && !!fcmToken);
    if (routing.channels.length === 0) return;

    const card = details.searchQuery?.trim() || 'the card you requested';
    const extra = details.note?.trim() ? ` ${details.note.trim()}` : '';

    try {
        await courier.send.message({
            message: {
                to: recipient,
                content: {
                    title: "CardStreet: Your requested card is here! 🎴",
                    body: `Good news — "${card}" has been added to the CardStreet catalog and is now searchable.${extra} Open the app and search for it to add it to your collection or find it on the marketplace.`,
                },
                routing,
                data: { type: 'card_request_fulfilled', searchQuery: card },
            },
        });
        console.log(`[Courier] ✅ 'Card Request Fulfilled' notification sent to requester ${requesterId}`);
    } catch (error) {
        console.error(`[Courier] ❌ Error sending 'Card Request Fulfilled' notification to ${requesterId}:`, error);
    }
}

// ─── First-time seller sale email ───────────────────────────────────────────

/**
 * Order statuses that count as a real, paid sale for the "first sale" test.
 * Mirrors the backfill in
 * supabase/migrations/20260617_add_first_sale_email_sent_at.sql. Pre-payment
 * (`pending`, `pending_payment`, `awaiting_shipping_payment`) and dead-end
 * (`cancelled`, `disputed`) statuses are intentionally excluded — they are not
 * money in the seller's pocket.
 */
const VALID_FIRST_SALE_STATUSES = [
    'paid',
    'label_generated',
    'shipped',
    'in_transit',
    'out_for_delivery',
    'delivered',
    'completed',
] as const;

// Minimal shape of the Courier client we depend on, so tests can inject a fake
// without constructing a real CourierClient.
type CourierLike = { send: { message: (payload: any) => Promise<any> } };

export interface FirstTimeSaleDeps {
    /** Injected Courier client (tests). Defaults to the lazy module client. */
    courier?: CourierLike | null;
    /** Injected service-role Supabase client (tests). Defaults to the module admin client. */
    supabaseAdmin?: SupabaseClient;
}

function appBaseUrl(): string {
    return (process.env.NEXT_PUBLIC_APP_URL || 'https://cardstreet.app').replace(/\/+$/, '');
}

// ─── Internal ops alert: welcome-package partner activated their account ─────

/**
 * Notifies the CardStreet team when a cold-provisioned partner activates the
 * account from their mailed welcome package — i.e. they signed in with the
 * username + temp password printed in their letter and finished setup (real
 * email, phone, new password) via /api/partner/complete-onboarding.
 *
 * This is an internal "which gifts converted" signal, so it goes to a single
 * ops inbox (PARTNER_ACTIVATION_NOTIFY_EMAIL, default the founder's address)
 * with inline content rather than a customer-facing Courier template — no
 * dashboard template to author or keep in sync. Best-effort: never throws, so
 * a notification hiccup can't fail the partner's activation. The caller fires
 * it exactly once per partner (the onboarding route short-circuits on repeat
 * calls), so there's no idempotency guard here.
 */
export async function sendPartnerActivatedNotification(partner: {
    shopName: string;
    username: string;
    email: string;
    phone: string;
    level?: number | null;
    slug?: string | null;
}): Promise<void> {
    const courier = getCourier();
    if (!courier) { console.warn('[Courier] Client not initialized — skipping partner-activated alert'); return; }

    const to = (process.env.PARTNER_ACTIVATION_NOTIFY_EMAIL || 'brandonlcole35@gmail.com').trim();
    if (!to) return;

    const joinLink = partner.slug ? `${appBaseUrl()}/join/${partner.slug}` : null;
    const activatedAt = new Date().toLocaleString('en-US', {
        timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short',
    });
    const lines = [
        `Shop: ${partner.shopName}`,
        `Username: ${partner.username}`,
        `Email: ${partner.email}`,
        `Phone: ${partner.phone}`,
        partner.level != null ? `Partner level: ${partner.level}` : null,
        joinLink ? `Referral link: ${joinLink}` : null,
        `Activated: ${activatedAt} (Bangkok)`,
    ].filter(Boolean) as string[];

    try {
        const sendResult = await courier.send.message({
            message: {
                to: { email: to },
                content: {
                    title: `New partner activated: ${partner.shopName}`,
                    body:
                        'A welcome-package partner just activated their CardStreet account ' +
                        '(signed in with their mailed credentials and set a new password).\n\n' +
                        lines.join('\n'),
                },
                routing: { method: 'all', channels: ['email'] },
                data: { type: 'partner_activated', username: partner.username },
            },
        });
        console.log(
            `[Courier] ✅ 'Partner Activated' alert sent for ${partner.username} → ${to}. ` +
            `Request ID: ${(sendResult as { requestId?: string })?.requestId ?? 'n/a'}`,
        );
    } catch (error) {
        console.error(`[Courier] ❌ Error sending 'Partner Activated' alert for ${partner.username}:`, error);
    }
}

/**
 * Sends the one-time "First Time Sale" onboarding email to a seller the very
 * first time one of their orders reaches a paid (ship-now) status.
 *
 * Idempotency & ordering (why claim-before-send):
 *   1. Short-circuit if `profiles.first_sale_email_sent_at` is already set.
 *   2. Skip unless this is the seller's only valid sale (count == 1) — protects
 *      sellers who sold before this feature shipped (their column was backfilled
 *      in the migration, but the count check is a second, independent guard).
 *   3. Atomically CLAIM the slot:
 *        UPDATE profiles SET first_sale_email_sent_at = now()
 *        WHERE id = :seller AND first_sale_email_sent_at IS NULL
 *      Only one concurrent caller (duplicate webhook + /finalize fallback) wins
 *      the compare-and-swap; the rest match zero rows and bail.
 *   4. Send via Courier. The timestamp is written BEFORE the send, so a success
 *      followed by a crash can never double-send. If the send itself fails we
 *      roll the claim back to NULL (guarded to our own timestamp) so a later
 *      redelivery can retry — trading a possible missed email for never
 *      double-emailing.
 *
 * Never throws: fulfillment must not be blocked by a notification failure.
 * Returns 'sent' | 'skipped' | 'error' for callers/tests that care.
 */
export async function sendFirstTimeSaleEmail(
    sellerId: string,
    opts: { orderId: string; orderNumber?: string },
    deps: FirstTimeSaleDeps = {},
): Promise<'sent' | 'skipped' | 'error'> {
    const courier = deps.courier !== undefined ? deps.courier : getCourier();
    if (!courier) {
        console.warn('[Courier] Client not initialized — skipping first-sale email');
        return 'skipped';
    }
    const supabaseAdmin = deps.supabaseAdmin ?? getSupabaseAdmin();

    try {
        // ── 1. Cheap pre-check: already sent? ──
        const { data: profile, error: profileErr } = await supabaseAdmin
            .from('profiles')
            .select('display_name, first_sale_email_sent_at')
            .eq('id', sellerId)
            .single();

        if (profileErr) {
            console.error(`[Courier] ❌ first-sale: failed to load profile ${sellerId}:`, profileErr);
            return 'error';
        }
        if (profile?.first_sale_email_sent_at) {
            // Already sent (or claimed by a concurrent worker that won the CAS).
            return 'skipped';
        }

        // ── 2. Is this really the seller's FIRST valid sale? ──
        const { count, error: countErr } = await supabaseAdmin
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .eq('seller_id', sellerId)
            .in('status', VALID_FIRST_SALE_STATUSES as unknown as string[]);

        if (countErr) {
            console.error(`[Courier] ❌ first-sale: failed to count sales for ${sellerId}:`, countErr);
            return 'error';
        }
        if ((count ?? 0) !== 1) {
            // Either no paid sale yet, or this is not their first one.
            return 'skipped';
        }

        // ── 3. Resolve the seller's email (transactional — sent regardless of
        // marketing/notification prefs, but we still need an address). ──
        const { data: { user }, error: authErr } = await supabaseAdmin.auth.admin.getUserById(sellerId);
        const email = (!authErr && user?.email) ? user.email : null;
        if (!email) {
            console.warn(`[Courier] ⚠️  No email for seller ${sellerId} — skipping first-sale email`);
            return 'skipped';
        }

        // ── 4. Atomically claim the one-shot slot (compare-and-swap). ──
        const claimedAt = new Date().toISOString();
        const { data: claimed, error: claimErr } = await supabaseAdmin
            .from('profiles')
            .update({ first_sale_email_sent_at: claimedAt })
            .eq('id', sellerId)
            .is('first_sale_email_sent_at', null)
            .select('id');

        if (claimErr) {
            console.error(`[Courier] ❌ first-sale: claim update failed for ${sellerId}:`, claimErr);
            return 'error';
        }
        if (!claimed || claimed.length === 0) {
            // Lost the race — another worker already claimed/sent.
            console.log(`[Courier] first-sale slot already claimed for ${sellerId} — skipping`);
            return 'skipped';
        }

        // ── 5. Build payload + send the "First Time Sale" template. ──
        // Prefer an explicit template ID; fall back to the Courier event alias.
        const template = (process.env.COURIER_FIRST_TIME_SALE_TEMPLATE_ID || TEMPLATES.firstTimeSale).trim();
        const firstName = (profile?.display_name || '').trim().split(/\s+/)[0] || 'there';
        const orderNumber = opts.orderNumber || opts.orderId;
        // Deep-link straight to the addressable order page (app/orders/[id]).
        const orderLink = `${appBaseUrl()}/orders/${opts.orderId}`;
        const supportEmail = (process.env.CARDSTREET_SUPPORT_EMAIL || 'support@thailandtcg.com').trim();
        const youtube = (process.env.YOUTUBE_PACKAGING_GUIDE_URL || '').trim();

        const data: Record<string, string> = {
            seller_first_name: firstName,
            order_number: orderNumber,
            order_link: orderLink,
            support_email: supportEmail,
        };
        // Optional — don't break the send if the guide URL isn't configured yet.
        if (youtube) data.youtube_packaging_link = youtube;

        try {
            const sendResult = await courier.send.message({
                message: {
                    to: { email },
                    // The "First Time Sale" template owns the subject/body
                    // ("Congrats on your first Cardstreet sale 🎉") — we only
                    // supply the merge data above.
                    template,
                    data,
                    routing: { method: 'all', channels: ['email'] },
                },
            });
            console.log(
                `[Courier] ✅ 'First Time Sale' email sent to seller ${sellerId} (order ${orderNumber}). ` +
                `Request ID: ${(sendResult as { requestId?: string })?.requestId ?? 'n/a'}`
            );
            return 'sent';
        } catch (sendErr) {
            // Send failed — roll the claim back so a later retry can resend.
            // Guard on our own timestamp so we never clobber a newer claim.
            console.error(`[Courier] ❌ Error sending 'First Time Sale' email to ${sellerId}:`, sendErr);
            const { error: rollbackErr } = await supabaseAdmin
                .from('profiles')
                .update({ first_sale_email_sent_at: null })
                .eq('id', sellerId)
                .eq('first_sale_email_sent_at', claimedAt);
            if (rollbackErr) {
                console.error(`[Courier] ❌ first-sale: failed to roll back claim for ${sellerId} (email will not retry):`, rollbackErr);
            }
            return 'error';
        }
    } catch (err) {
        console.error(`[Courier] ❌ Unexpected error in first-sale email for ${sellerId}:`, err);
        return 'error';
    }
}

// ─── Stalled Stripe onboarding reminder ──────────────────────────────────────

/**
 * One-time "finish your payout setup" email for sellers who created a Stripe
 * connected account but abandoned the hosted onboarding (details never
 * submitted). Candidates are selected by the daily cron
 * (app/api/cron/stripe-setup-nudge); this function re-verifies eligibility so
 * a seller who finished onboarding between the cron's query and the send is
 * never nudged.
 *
 * Same idempotency scheme as sendFirstTimeSaleEmail: atomically CLAIM
 * profiles.stripe_setup_nudge_sent_at (CAS on NULL) before sending, roll the
 * claim back if the send fails. One email per seller, ever.
 *
 * Copy is inline and bilingual (TH first — the server can't know the seller's
 * UI language). The CTA deep-links to /?stripe_connect=refresh, which the
 * mobile shell + Profile + StripeConnectSection already turn into an immediate
 * resume of the hosted flow; on a phone with the app installed, cardstreet.app
 * App-Links straight into the native app.
 */
export async function sendStripeSetupReminderEmail(
    userId: string,
    deps: FirstTimeSaleDeps = {},
): Promise<'sent' | 'skipped' | 'error'> {
    const courier = deps.courier !== undefined ? deps.courier : getCourier();
    if (!courier) {
        console.warn('[Courier] Client not initialized — skipping Stripe setup reminder');
        return 'skipped';
    }
    const supabaseAdmin = deps.supabaseAdmin ?? getSupabaseAdmin();

    try {
        // ── 1. Re-verify eligibility (the cron's snapshot may be stale). ──
        const { data: profile, error: profileErr } = await supabaseAdmin
            .from('profiles')
            .select('display_name, stripe_account_id, stripe_details_submitted, stripe_charges_enabled, stripe_setup_nudge_sent_at')
            .eq('id', userId)
            .single();

        if (profileErr || !profile) {
            console.error(`[Courier] ❌ setup-nudge: failed to load profile ${userId}:`, profileErr);
            return 'error';
        }
        if (
            !profile.stripe_account_id ||
            profile.stripe_details_submitted === true ||
            profile.stripe_charges_enabled === true ||
            profile.stripe_setup_nudge_sent_at
        ) {
            return 'skipped';
        }

        // ── 2. Resolve the seller's email. ──
        const { data: { user }, error: authErr } = await supabaseAdmin.auth.admin.getUserById(userId);
        const email = (!authErr && user?.email) ? user.email : null;
        if (!email) {
            console.warn(`[Courier] ⚠️  No email for seller ${userId} — skipping setup nudge`);
            return 'skipped';
        }

        // ── 3. Atomically claim the one-shot slot. ──
        const claimedAt = new Date().toISOString();
        const { data: claimed, error: claimErr } = await supabaseAdmin
            .from('profiles')
            .update({ stripe_setup_nudge_sent_at: claimedAt })
            .eq('id', userId)
            .is('stripe_setup_nudge_sent_at', null)
            .select('id');

        if (claimErr) {
            console.error(`[Courier] ❌ setup-nudge: claim update failed for ${userId}:`, claimErr);
            return 'error';
        }
        if (!claimed || claimed.length === 0) {
            return 'skipped'; // lost the race to a concurrent run
        }

        // ── 4. Send. Roll the claim back on failure so a later run retries. ──
        const resumeUrl = `${appBaseUrl()}/?stripe_connect=refresh`;
        const supportEmail = (process.env.CARDSTREET_SUPPORT_EMAIL || 'support@thailandtcg.com').trim();
        const firstName = (profile.display_name || '').trim().split(/\s+/)[0];

        try {
            const sendResult = await courier.send.message({
                message: {
                    to: { email },
                    content: {
                        title: 'ตั้งค่าการรับเงินของคุณอีกนิดเดียวเสร็จ — Finish your CardStreet payout setup',
                        body:
                            `${firstName ? `สวัสดีคุณ ${firstName},\n\n` : ''}` +
                            'คุณเริ่มตั้งค่าการรับเงินบน CardStreet ไว้แล้วแต่ยังไม่เสร็จ — ' +
                            'เหลืออีกเพียงไม่กี่ขั้นตอน (ประมาณ 2 นาที) ก็พร้อมลงขายการ์ด ' +
                            'และรับเงินเข้าบัญชีธนาคารของคุณโดยตรง\n\n' +
                            `กลับมาทำต่อได้ที่: ${resumeUrl}\n\n` +
                            '- - -\n\n' +
                            `${firstName ? `Hi ${firstName},\n\n` : ''}` +
                            'You started setting up payouts on CardStreet but didn\'t finish — ' +
                            'only a few steps remain (about 2 minutes) before you can list cards ' +
                            'for sale and get paid directly to your bank account.\n\n' +
                            `Pick up where you left off: ${resumeUrl}\n\n` +
                            `Questions? Contact ${supportEmail}`,
                    },
                    routing: { method: 'all', channels: ['email'] },
                    data: { type: 'stripe_setup_nudge' },
                },
            });
            console.log(
                `[Courier] ✅ Stripe setup reminder sent to ${userId}. ` +
                `Request ID: ${(sendResult as { requestId?: string })?.requestId ?? 'n/a'}`,
            );
            return 'sent';
        } catch (sendErr) {
            console.error(`[Courier] ❌ Error sending Stripe setup reminder to ${userId}:`, sendErr);
            const { error: rollbackErr } = await supabaseAdmin
                .from('profiles')
                .update({ stripe_setup_nudge_sent_at: null })
                .eq('id', userId)
                .eq('stripe_setup_nudge_sent_at', claimedAt);
            if (rollbackErr) {
                console.error(`[Courier] ❌ setup-nudge: failed to roll back claim for ${userId} (email will not retry):`, rollbackErr);
            }
            return 'error';
        }
    } catch (err) {
        console.error(`[Courier] ❌ Unexpected error in Stripe setup reminder for ${userId}:`, err);
        return 'error';
    }
}

/**
 * CardStreet Pro perk: tells a wishlister that a card on their wishlist was
 * just listed for sale. Entitlement filtering and dedupe happen in the caller
 * (lib/wishlistAlerts.ts) -- this only handles prefs, channels, and the send.
 *
 * No designed Courier template exists yet, so the copy is inline `content`
 * (bilingual EN/TH -- the UI language preference is client-side only, so the
 * server can't pick one). Set COURIER_WISHLIST_ALERT_TEMPLATE_ID once a
 * dashboard template is authored and the send switches to it automatically.
 *
 * Returns true only when a send was actually dispatched, so the caller logs
 * the dedupe row for real sends only.
 */
export async function sendWishlistListingAlert(
    userId: string,
    listing: {
        listingId: string;
        cardId: string;
        cardName: string;
        price: number;
        condition: string;
    },
): Promise<boolean> {
    const courier = getCourier();
    if (!courier) { console.warn('[Courier] Client not initialized — skipping wishlist alert'); return false; }

    const { email, fcmToken, prefs } = await getUserNotifContext(userId);
    // `!== false` so accounts predating the wishlist_email/wishlist_push
    // columns (or a missing prefs row) default to ON, like the other alerts.
    const wantEmail = prefs.wishlist_email !== false && !!email;
    const wantPush = prefs.wishlist_push !== false && !!fcmToken;
    if (!wantEmail && !wantPush) return false;

    const recipient = buildRecipient(wantEmail ? email : null, wantPush ? fcmToken : null);
    const routing = buildRouting(wantEmail, wantPush);

    const priceLabel = `฿${Number(listing.price).toLocaleString('en-US')}`;
    const templateId = (process.env.COURIER_WISHLIST_ALERT_TEMPLATE_ID || '').trim();

    const message: Record<string, unknown> = {
        to: recipient,
        routing,
        data: {
            cardName: listing.cardName,
            condition: listing.condition,
            price: listing.price,
            priceLabel,
            // Push deep-link payload (read by the mobile FCM handler).
            listingId: listing.listingId,
            cardId: listing.cardId,
            type: 'wishlist_listing',
        },
    };
    if (templateId) {
        message.template = templateId;
    } else {
        message.content = {
            title: `${listing.cardName} just listed — ${priceLabel}`,
            body:
                `${listing.cardName} (${listing.condition}) from your wishlist was just listed for ${priceLabel} on CardStreet. ` +
                `การ์ดใน Wishlist ของคุณเพิ่งถูกลงขาย — เปิด CardStreet เพื่อดูก่อนใคร`,
        };
    }

    try {
        const sendResult = await courier.send.message({ message: message as any });
        console.log(`[Courier] ✅ Wishlist alert sent to ${userId} for listing ${listing.listingId}. Request ID: ${(sendResult as { requestId?: string })?.requestId ?? 'n/a'}`);
        return true;
    } catch (error) {
        console.error(`[Courier] ❌ Error sending wishlist alert to ${userId}:`, error);
        return false;
    }
}

// ─── OBO Best-Offer notifications ────────────────────────────────────────────

/**
 * Shape passed to every offer notification. Only `offerId` + `listingId` are
 * required (they drive the FCM deep-link); the rest is display copy the
 * template (or inline fallback) reads.
 */
export interface OfferNotifDetails {
    offerId: string;
    listingId: string;
    amount?: number;
    cardName?: string;
}

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://cardstreet.app').replace(/\/$/, '');

/**
 * Branded Courier Elemental content for an offer email. `meta.title` is the email
 * subject; the two text blocks are the bilingual body (EN then TH, muted); the
 * action is a CTA button. The Courier default brand wraps this with the logo /
 * header. Push renders meta.title as the title and the text blocks as the body.
 * Rendering falls to this only when no dashboard template id is set for the event.
 */
function buildOfferEmailContent(c: { subject: string; bodyEn: string; bodyTh: string; cta: string }) {
    return {
        version: '2022-01-01',
        elements: [
            { type: 'meta', title: c.subject },
            { type: 'text', content: c.bodyEn },
            { type: 'text', content: c.bodyTh, color: '#6b7280' },
            { type: 'action', content: c.cta, href: `${APP_URL}/?view=offers`, style: 'button', align: 'center', background_color: '#0891b2' },
        ],
    };
}

/**
 * Internal helper: send one offer notification. Mirrors sendSoldNotification's
 * prefs/channels/early-exit logic and sendWishlistListingAlert's template-or-
 * inline-content fallback (so a dark->live flip doesn't require the dashboard
 * templates to land first). Always passes `template:` + `data`, never `content`
 * once a template id is set. Never throws.
 */
async function sendOfferNotification(
    recipientId: string,
    kind: 'received' | 'accepted' | 'rejected' | 'countered' | 'expired',
    details: OfferNotifDetails,
    cfg: {
        emailPref: string;
        pushPref: string;
        template: string;
        pushType: string;
        inline: (priceLabel: string, cardName: string) => { subject: string; bodyEn: string; bodyTh: string; cta: string };
    },
): Promise<void> {
    const courier = getCourier();
    if (!courier) { console.warn(`[Courier] Client not initialized — skipping offer-${kind} notification`); return; }

    const { email, fcmToken, prefs } = await getUserNotifContext(recipientId);
    // `!== false` so accounts predating the offer_* pref columns default to ON.
    const wantEmail = prefs[cfg.emailPref] !== false && !!email;
    const wantPush = prefs[cfg.pushPref] !== false && !!fcmToken;
    if (!wantEmail && !wantPush) return;

    const recipient = buildRecipient(wantEmail ? email : null, wantPush ? fcmToken : null);
    const routing = buildRouting(wantEmail, wantPush);
    if (routing.channels.length === 0) return;

    const priceLabel = details.amount != null ? `฿${Number(details.amount).toLocaleString('en-US')}` : '';
    const cardName = details.cardName || 'a card';

    const message: Record<string, unknown> = {
        to: recipient,
        routing,
        data: {
            offerId: details.offerId,
            listingId: details.listingId,
            amount: details.amount,
            priceLabel,
            cardName,
            // Push deep-link payload (read by the mobile FCM handler).
            type: cfg.pushType,
        },
    };
    if (cfg.template) {
        message.template = cfg.template;
    } else {
        message.content = buildOfferEmailContent(cfg.inline(priceLabel, cardName));
    }

    try {
        const sendResult = await courier.send.message({ message: message as any });
        console.log(`[Courier] ✅ Offer-${kind} notification sent to ${recipientId} (offer ${details.offerId}). Request ID: ${(sendResult as { requestId?: string })?.requestId ?? 'n/a'}`);
    } catch (error) {
        console.error(`[Courier] ❌ Error sending offer-${kind} notification to ${recipientId}:`, error);
        // Safety net for the never-live-proven Elemental path: if we sent inline
        // branded content and Courier rejected it, retry once with the proven simple
        // {title, body} format (same shape as live wishlist alerts) so a formatting
        // issue never means zero email. Skipped when a dashboard template was used.
        if (!cfg.template) {
            try {
                const c = cfg.inline(priceLabel, cardName);
                const fallbackMessage = { ...message, content: { title: c.subject, body: `${c.bodyEn} ${c.bodyTh}` } };
                await courier.send.message({ message: fallbackMessage as any });
                console.log(`[Courier] ↩︎ Offer-${kind} sent via simple-content fallback to ${recipientId}.`);
            } catch (fallbackError) {
                console.error(`[Courier] ❌ Offer-${kind} fallback send also failed for ${recipientId}:`, fallbackError);
            }
        }
    }
}

/** Seller (or the counterparty being countered) got a new offer. */
export async function sendOfferReceivedNotification(recipientId: string, details: OfferNotifDetails): Promise<void> {
    return sendOfferNotification(recipientId, 'received', details, {
        emailPref: 'offer_email',
        pushPref: 'offer_push',
        template: TEMPLATES.offerReceived,
        pushType: 'offer_received',
        inline: (priceLabel, cardName) => ({
            subject: `New offer${priceLabel ? ` (${priceLabel})` : ''} on ${cardName}`,
            bodyEn: `You received an offer${priceLabel ? ` of ${priceLabel}` : ''} on ${cardName}. Open CardStreet to accept, counter, or decline.`,
            bodyTh: `คุณได้รับข้อเสนอราคาใหม่บน ${cardName} — เปิด CardStreet เพื่อตอบรับ ต่อรอง หรือปฏิเสธ`,
            cta: 'Respond · ตอบกลับ',
        }),
    });
}

/** The offer's buyer: their offer was accepted and can now be paid. */
export async function sendOfferAcceptedNotification(buyerId: string, details: OfferNotifDetails): Promise<void> {
    return sendOfferNotification(buyerId, 'accepted', details, {
        emailPref: 'offer_accepted_email',
        pushPref: 'offer_accepted_push',
        template: TEMPLATES.offerAccepted,
        pushType: 'offer_accepted',
        inline: (priceLabel, cardName) => ({
            subject: `Offer accepted — ${cardName}`,
            bodyEn: `Your offer${priceLabel ? ` of ${priceLabel}` : ''} on ${cardName} was accepted. Pay now to complete the purchase before someone else buys it.`,
            bodyTh: `ข้อเสนอของคุณได้รับการตอบรับแล้ว — ชำระเงินให้เสร็จก่อนใคร`,
            cta: 'Pay now · ชำระเงิน',
        }),
    });
}

/** The offeror: their offer was rejected. */
export async function sendOfferRejectedNotification(offerorId: string, details: OfferNotifDetails): Promise<void> {
    return sendOfferNotification(offerorId, 'rejected', details, {
        emailPref: 'offer_rejected_email',
        pushPref: 'offer_rejected_push',
        template: TEMPLATES.offerRejected,
        pushType: 'offer_rejected',
        inline: (priceLabel, cardName) => ({
            subject: `Offer declined — ${cardName}`,
            bodyEn: `Your offer${priceLabel ? ` of ${priceLabel}` : ''} on ${cardName} was declined. You can make a new offer anytime.`,
            bodyTh: `ข้อเสนอของคุณถูกปฏิเสธ — ลองเสนอราคาใหม่ได้ที่ CardStreet`,
            cta: 'Browse · เลือกซื้อ',
        }),
    });
}

/** The offeror of the parent: the counterparty countered with a new amount. */
export async function sendOfferCounteredNotification(offerorId: string, details: OfferNotifDetails): Promise<void> {
    return sendOfferNotification(offerorId, 'countered', details, {
        emailPref: 'offer_countered_email',
        pushPref: 'offer_countered_push',
        template: TEMPLATES.offerCountered,
        pushType: 'offer_countered',
        inline: (priceLabel, cardName) => ({
            subject: `Counter offer${priceLabel ? ` (${priceLabel})` : ''} on ${cardName}`,
            bodyEn: `You got a counter offer${priceLabel ? ` of ${priceLabel}` : ''} on ${cardName}. Open CardStreet to accept, counter back, or decline.`,
            bodyTh: `คุณได้รับข้อเสนอต่อรองราคาบน ${cardName} — เปิด CardStreet เพื่อตอบรับ ต่อรองกลับ หรือปฏิเสธ`,
            cta: 'Respond · ตอบกลับ',
        }),
    });
}

/** The offeror: their offer expired at 48h, or was voided because the listing sold. */
export async function sendOfferExpiredNotification(offerorId: string, details: OfferNotifDetails): Promise<void> {
    return sendOfferNotification(offerorId, 'expired', details, {
        emailPref: 'offer_expired_email',
        pushPref: 'offer_expired_push',
        template: TEMPLATES.offerExpired,
        pushType: 'offer_expired',
        inline: (priceLabel, cardName) => ({
            subject: `Offer expired — ${cardName}`,
            bodyEn: `Your offer${priceLabel ? ` of ${priceLabel}` : ''} on ${cardName} is no longer active (it expired or the listing sold).`,
            bodyTh: `ข้อเสนอของคุณสิ้นสุดแล้ว — เปิด CardStreet เพื่อดูรายการอื่น`,
            cta: 'Browse · เลือกซื้อ',
        }),
    });
}
