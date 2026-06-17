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
                content: {
                    title: "CardStreet: You have a new sale! 🎉",
                    body: `Your item has been sold for ฿${orderDetails.total_amount.toLocaleString()}. The buyer has paid for shipping — check your email for the Flash Express label to print.`,
                },
                routing,
                data: { orderId: orderDetails.id, type: 'sold' }
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

    const dashboardUrl = 'https://cardstreet.app/profile';
    const hasAttachment = !!labelPdfBase64;
    const body = hasAttachment
        ? `Your Flash Express label for order ${orderDetails.id} is ready — the PDF is attached to this email. Print it and drop your package at any Flash Express location. You can also re-download it anytime from your CardStreet seller dashboard: ${dashboardUrl}`
        : `Your Flash Express label for order ${orderDetails.id} is ready. Open it from your CardStreet seller dashboard: ${dashboardUrl}`;

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
                content: {
                    title: "CardStreet: Shipping Label Ready 📦",
                    body,
                },
                routing,
                ...(providers ? { providers } : {}),
                data: { orderId: orderDetails.id, type: 'label_generated' },
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

    try {
        await courier.send.message({
            message: {
                to: recipient,
                content: {
                    title: "CardStreet: Your order has shipped! 🚀",
                    body: `Order ${orderDetails.id} is on its way via Flash Express! Track it at: https://www.flashexpress.com/fle/tracking?se=${trackingUrl}`,
                },
                routing,
                data: { orderId: orderDetails.id, type: 'shipped', trackingUrl }
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

    const trackingText = trackingNumbers.length > 0
        ? `\n\nFlash Express tracking number(s): ${trackingNumbers.join(', ')}`
        : '\n\nYour seller will be notified to ship your item shortly.';

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
                    title: "CardStreet: Order Confirmed! ✅",
                    body: `Thank you for your purchase of ฿${orderDetails.total_amount?.toLocaleString() || ''}. Your items are being prepared for shipment.${trackingText}`,
                },
                routing,
                data: { orderId: orderDetails.id, type: 'order_confirmation', trackingNumbers }
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
        const template = (process.env.COURIER_FIRST_TIME_SALE_TEMPLATE_ID || 'seller_first_sale').trim();
        const firstName = (profile?.display_name || '').trim().split(/\s+/)[0] || 'there';
        const orderNumber = opts.orderNumber || opts.orderId;
        // TODO: there is no dedicated seller order-detail route today — the sales
        // list lives in the client-state Profile panel (components/Profile.tsx,
        // activePanel === 'sales'). Deep-link there once a /profile/orders/[id]
        // (or query-param-addressable panel) route exists.
        const orderLink = `${appBaseUrl()}/profile`;
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
