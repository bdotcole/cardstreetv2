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
