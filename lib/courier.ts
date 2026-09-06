import CourierClient from "@trycourier/courier";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_LABELS } from "./breakerApplication";
import { unsubscribeUrl } from "./unsubscribeToken";

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
    offerPaymentReminder: (process.env.COURIER_OFFER_PAYMENT_REMINDER_TEMPLATE_ID || '').trim(),
} as const;

/**
 * Full email subjects for the templates above, forced onto the outbound email
 * via a Postmark per-provider override on every template send.
 *
 * Why: Courier's email renderer truncates non-ASCII subjects to their first
 * 48 UTF-8 bytes — exactly one 64-character base64 line of the RFC 2047
 * encoded-word — so every Thai subject arrived cut to 16 characters
 * ("คุณมีคำสั่งซื้อใหม่ — New sale!" arrived as "คุณมีคำสั่งซื้อใ").
 * Verified 2026-07-22 against the Courier API: GET /notifications/{id}/content
 * returns the full subject while GET /messages/{id}/output shows the rendered
 * email subject cut at 48 bytes (message 1-6a60da35-e4b93517a8242321f89d75ef).
 * The email body and the push title render fine — only the email subject is
 * affected, and only when it contains non-ASCII. Postmark itself encodes
 * multi-byte subjects correctly, so handing it the subject directly bypasses
 * Courier's broken encoder.
 *
 * KEEP IN SYNC with the email subject authored in each Courier dashboard
 * template — this override always wins over the dashboard subject. Remove
 * once Courier fixes their subject rendering (support ticket filed 2026-07-22).
 */
const SUBJECTS: Partial<Record<keyof typeof TEMPLATES, string>> = {
    sold: 'คุณมีคำสั่งซื้อใหม่ — New sale!',
    labelGenerated: 'ใบปะหน้าพัสดุพร้อมแล้ว — Shipping label ready',
    shipped: 'สินค้าถูกจัดส่งแล้ว Order Shipped!',
    orderConfirmed: 'ยืนยันคำสั่งซื้อ Order Confirmed!',
    // firstTimeSale: that subject is ASCII plus one emoji (43 UTF-8 bytes,
    // under the 48-byte cliff) so it renders intact without an override.
    // Offer templates: add entries alongside the env IDs when those dashboard
    // templates go live, or any Thai subject on them will truncate.
};

/**
 * Postmark provider override forcing the full email subject (see SUBJECTS).
 * `extraBody` merges additional Postmark API fields into the same override
 * (e.g. the shipping-label PDF in Attachments).
 */
function postmarkOverride(subject: string | undefined, extraBody?: Record<string, unknown>) {
    const body = { ...(subject ? { Subject: subject } : {}), ...(extraBody ?? {}) };
    if (Object.keys(body).length === 0) return undefined;
    return { postmark: { override: { body } } };
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
        // OBO Best-Offer prefs. A user whose prefs row predates the
        // 20260707_offer_notification_prefs migration (or has no row) still gets
        // defaults. The migration is NOT NULL DEFAULT true, so a spread of the
        // real row never overrides these with a NULL.
        offer_email: true, offer_push: true,
        offer_accepted_email: true, offer_accepted_push: true,
        offer_rejected_email: true, offer_rejected_push: true,
        offer_countered_email: true, offer_countered_push: true,
        offer_expired_email: true, offer_expired_push: true,
        // Live-show blasts (20260824_show_blast_preferences). Same reasoning:
        // NOT NULL DEFAULT true in the migration, so a real row never spreads
        // a NULL over these, and an account with no prefs row at all still
        // resolves to opted-in.
        show_live_email: true, show_live_push: true,
        // Retention pushes (streak-at-risk, weekly digest). These have NO
        // migration behind them yet, on purpose: the spread above cannot
        // override a default with a column that does not exist, so both resolve
        // to opted-in today, and adding real columns later starts honoring them
        // with no code change. The streak nudge is deliberately push-only —
        // a daily email about a check-in streak is spam by any measure.
        streak_push: true,
        digest_email: true, digest_push: true,
        demand_email: true, demand_push: true,
        stale_listing_email: true, stale_listing_push: true,
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
 *
 * `contentSource` decides how the push channel is addressed, and the
 * distinction is load-bearing — verified against the live Courier API
 * 2026-07-31 by sending the same inline payload to the same device token twice,
 * varying only this value:
 *
 * - `'template'` leaves it as the generic `push` channel. The dashboard
 *   template binds that channel to the FCM integration, so Courier resolves it
 *   to `firebase-fcm` and the device gets the notification.
 * - `'inline'` has no such binding, and Courier silently falls back to its own
 *   Courier Inbox provider instead of Firebase. The email still goes out, so
 *   the send looks healthy in the logs while the push is quietly dropped.
 *   Naming the provider pins it to FCM.
 *
 * This is why every inline notification produced zero pushes while the four
 * template-backed ones worked: over a 30-day window, 154 of 191 sends routed to
 * Inbox rather than FCM. Keep `'template'` on the bare channel — that path has
 * been delivering in production and re-pinning it was not worth the risk.
 */
function buildRouting(wantEmail: boolean, wantPush: boolean, contentSource: 'template' | 'inline') {
    const channels: string[] = [];
    if (wantEmail) channels.push("email");
    if (wantPush) channels.push(contentSource === 'inline' ? "firebase-fcm" : "push");
    return { method: "all" as const, channels };
}

/**
 * Element `channels` filter for push-only Elemental elements. Lists both the
 * channel class and the provider name because our inline routing addresses the
 * provider directly ("firebase-fcm", see buildRouting) — whichever string
 * Courier matches element scoping against, the element renders on the push
 * and nowhere else.
 */
const PUSH_ELEMENT_CHANNELS = ['push', 'firebase-fcm'];

/**
 * Elemental content that gives email and push DIFFERENT bodies in one send.
 *
 * Why: simple `content: {title, body}` renders the same body verbatim on
 * every routed channel, so copy written for email — paragraphs, raw URLs,
 * support footers — was landing in notification trays as multi-hundred-
 * character walls with visible links (push QC 2026-08-27, verified against
 * Courier's rendered-output API). Per-element `channels` scoping splits them:
 * email keeps the long-form copy and a CTA button, push gets one short line.
 * The push tap never needs a visible URL — the FCM handlers deep-link from
 * the message `data` payload (hooks/usePushNotifications.ts).
 *
 * `title` doubles as the email subject and the push title, so keep the
 * signal in front (trays and inbox lists truncate the tail). Thai titles
 * still need postmarkOverride(title) at the call site — Courier's email
 * subject encoder truncates non-ASCII at 48 bytes (see SUBJECTS).
 */
// Returns `any`: the SDK's ElementalContent union doesn't know the spec's
// per-element `channels` property (the API accepts it), and the existing
// Elemental sends already pass `message as any` for the same reason.
function emailPlusPushContent(c: {
    title: string;
    emailParagraphs: { text: string; muted?: boolean }[];
    cta?: { label: string; url: string };
    /** Muted line rendered under the CTA button (support contact, etc.). */
    emailFooter?: string;
    pushBody: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): any {
    return {
        version: '2022-01-01',
        elements: [
            { type: 'meta', title: c.title },
            ...c.emailParagraphs.map((p) => ({
                type: 'text',
                content: p.text,
                ...(p.muted ? { color: '#6b7280' } : {}),
                channels: ['email'],
            })),
            ...(c.cta
                ? [
                      {
                          type: 'action',
                          content: c.cta.label,
                          href: c.cta.url,
                          style: 'button',
                          align: 'center',
                          background_color: '#0891b2',
                          channels: ['email'],
                      },
                  ]
                : []),
            ...(c.emailFooter
                ? [{ type: 'text', content: c.emailFooter, color: '#6b7280', align: 'center', channels: ['email'] }]
                : []),
            { type: 'text', content: c.pushBody, channels: PUSH_ELEMENT_CHANNELS },
        ],
    };
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
    const routing = buildRouting(!!prefs.sold_email && !!email, !!prefs.sold_push && !!fcmToken, 'template');
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
                providers: postmarkOverride(SUBJECTS.sold),
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
    const routing = buildRouting(!!prefs.label_email && !!email, !!prefs.label_push && !!fcmToken, 'template');
    if (routing.channels.length === 0) return;

    const orderUrl = `${appBaseUrl()}/orders/${orderDetails.id}`;
    const hasAttachment = !!labelPdfBase64;

    // Postmark attachment rides the same per-provider override as the subject
    // fix. The override body is merged into Postmark's email API request, so
    // any standard Postmark field (Attachments included) is accepted there.
    const providers = postmarkOverride(
        SUBJECTS.labelGenerated,
        hasAttachment
            ? {
                  Attachments: [
                      {
                          Name: `cardstreet-label-${orderDetails.id}.pdf`,
                          Content: labelPdfBase64,
                          ContentType: 'application/pdf',
                      },
                  ],
              }
            : undefined,
    );

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
                    //
                    // These keys are EXACTLY aligned with the template — verified
                    // 2026-08-15 against the live Courier API (GET /notifications/
                    // 000AHF66.../content + GET /messages/{id}/output): the push
                    // block renders both values from this very payload. The email
                    // block's ENGLISH sentence still shows raw {orderDetails.id} /
                    // {labelUrl} because those two tokens were typed as PLAIN TEXT
                    // there — not <variable>-wrapped like the Thai sentence and the
                    // push block — and Courier only substitutes tokenized variables.
                    // No data payload can fix that; the cure is a dashboard edit
                    // (re-insert the two variables in the email block's English
                    // line). Do not "fix" this payload again.
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
    const routing = buildRouting(!!prefs.shipped_email && !!email, !!prefs.shipped_push && !!fcmToken, 'template');
    if (routing.channels.length === 0) return;

    const trackingLink = `https://www.flashexpress.com/fle/tracking?se=${trackingUrl}`;
    try {
        await courier.send.message({
            message: {
                to: recipient,
                template: TEMPLATES.shipped,
                routing,
                providers: postmarkOverride(SUBJECTS.shipped),
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
    const routing = buildRouting(!!wantEmail && !!email, !!wantPush && !!fcmToken, 'template');
    if (routing.channels.length === 0) return;

    try {
        await courier.send.message({
            message: {
                to: recipient,
                template: TEMPLATES.orderConfirmed,
                routing,
                providers: postmarkOverride(SUBJECTS.orderConfirmed),
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
    const routing = buildRouting(!!prefs.sold_email && !!email, !!prefs.sold_push && !!fcmToken, 'inline');
    if (routing.channels.length === 0) return;

    try {
        const title = 'การขายเสร็จสมบูรณ์ — Sale complete';
        await courier.send.message({
            message: {
                to: recipient,
                content: emailPlusPushContent({
                    title,
                    emailParagraphs: [
                        { text: 'The buyer confirmed receipt of your order. Your funds are being released to your account.' },
                        { text: 'ผู้ซื้อยืนยันรับสินค้าเรียบร้อยแล้ว — เงินจากคำสั่งซื้อนี้กำลังถูกโอนเข้าบัญชีของคุณ', muted: true },
                    ],
                    cta: { label: 'View order · ดูคำสั่งซื้อ', url: `${appBaseUrl()}/orders/${orderDetails.id}` },
                    pushBody: 'ผู้ซื้อยืนยันรับสินค้าแล้ว เงินกำลังถูกโอนให้คุณ · Buyer confirmed receipt — funds on the way.',
                }),
                routing,
                data: { orderId: orderDetails.id, type: 'purchase_completed' },
                providers: postmarkOverride(title),
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
    const routing = buildRouting(!!wantEmail && !!email, !!wantPush && !!fcmToken, 'inline');
    if (routing.channels.length === 0) return;

    try {
        const amountLabel = `฿${amount.toLocaleString()}`;
        await courier.send.message({
            message: {
                to: recipient,
                content: emailPlusPushContent({
                    // Amount-first: the figure IS the signal, and trays truncate
                    // the tail. Same copy as the TH-path send in
                    // supabase/functions/release-funds/index.ts — change both.
                    title: `Payout sent — ${amountLabel}`,
                    emailParagraphs: [
                        { text: `Your payout of ${amountLabel} for this order has been transferred to your Stripe account.` },
                        { text: `เงิน ${amountLabel} จากคำสั่งซื้อนี้ถูกโอนเข้าบัญชี Stripe ของคุณเรียบร้อยแล้ว`, muted: true },
                    ],
                    cta: { label: 'View order · ดูคำสั่งซื้อ', url: `${appBaseUrl()}/orders/${orderId}` },
                    pushBody: 'โอนเข้าบัญชี Stripe ของคุณแล้ว · Sent to your Stripe account.',
                }),
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
    const routing = buildRouting(!!wantEmail && !!email, !!wantPush && !!fcmToken, 'inline');
    if (routing.channels.length === 0) return;

    try {
        const title = 'พัสดุถึงแล้ว — Package delivered';
        await courier.send.message({
            message: {
                to: recipient,
                content: emailPlusPushContent({
                    title,
                    emailParagraphs: [
                        { text: `Your Flash Express package (${trackingNumber}) has been delivered. Please confirm receipt in the app to release the seller's funds.` },
                        { text: `พัสดุ Flash Express (${trackingNumber}) ของคุณจัดส่งเรียบร้อยแล้ว — กดยืนยันรับสินค้าในแอปเพื่อปล่อยเงินให้ผู้ขาย`, muted: true },
                    ],
                    cta: { label: 'Confirm receipt · ยืนยันรับสินค้า', url: `${appBaseUrl()}/orders/${orderId}` },
                    pushBody: 'กดยืนยันรับสินค้าในแอปเพื่อปล่อยเงินให้ผู้ขาย · Confirm receipt in the app.',
                }),
                routing,
                data: { orderId, type: 'package_delivered', trackingNumber },
                providers: postmarkOverride(title),
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
    const routing = buildRouting(!!wantEmail && !!email, !!wantPush && !!fcmToken, 'inline');
    if (routing.channels.length === 0) return;

    const card = details.searchQuery?.trim() || 'the card you requested';
    const extra = details.note?.trim() ? ` ${details.note.trim()}` : '';

    try {
        const title = `${card} is now on CardStreet`;
        await courier.send.message({
            message: {
                to: recipient,
                content: emailPlusPushContent({
                    title,
                    emailParagraphs: [
                        { text: `Good news — "${card}" has been added to the CardStreet catalog and is now searchable.${extra} Open the app and search for it to add it to your collection or find it on the marketplace.` },
                        { text: `การ์ดที่คุณขอ "${card}" ถูกเพิ่มเข้าแคตตาล็อกแล้ว — ค้นหาในแอปเพื่อเพิ่มเข้าคอลเลกชันหรือหาซื้อในตลาด`, muted: true },
                    ],
                    pushBody: 'การ์ดที่คุณขอถูกเพิ่มแล้ว — ค้นหาในแอปได้เลย · Search the app to collect or buy it.',
                }),
                routing,
                data: { type: 'card_request_fulfilled', searchQuery: card },
                // Requested cards can have Thai names, pushing the subject past
                // Courier's 48-byte encoded-word cliff (see SUBJECTS).
                providers: postmarkOverride(title),
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

// How many "finish your payout setup" touches a stalled seller gets, and the
// minimum gap between them. Three touches over ~5 days: enough follow-up to
// beat the one-shot email (which the 2026-07-16 funnel showed was saturated —
// 34 of 38 stalled sellers had it and were still stalled), while still ending.
export const NUDGE_MAX_TOUCHES = 3;
export const NUDGE_MIN_SPACING_MS = 48 * 3600_000;

/**
 * Per-touch bilingual copy (TH first — the server can't know the seller's UI
 * language). Escalates in urgency, and every touch repeats the prep hint that
 * components/StripePreScreen.tsx shows in-app: the two things sellers don't
 * have to hand (the laser code on the back of the Thai ID, and a selfie) are
 * what makes them bounce off Stripe's page.
 */
function stripeNudgeCopy(
    touch: number,
    firstName: string,
): { title: string; thBody: string; enBody: string; pushBody: string } {
    const thHi = firstName ? `สวัสดีคุณ ${firstName},\n\n` : '';
    const enHi = firstName ? `Hi ${firstName},\n\n` : '';
    const thPrep =
        'เตรียมบัตรประชาชน (พร้อมเลขเลเซอร์หลังบัตร) และเลขที่บัญชีธนาคารไว้ให้พร้อม ' +
        'แล้วจะใช้เวลาประมาณ 2 นาที';
    const enPrep =
        'Have your Thai ID card (with the laser code on the back) and your bank ' +
        'account number ready and it takes about 2 minutes.';

    const titles = [
        'ตั้งค่าการรับเงินของคุณอีกนิดเดียวเสร็จ — Finish your CardStreet payout setup',
        'การ์ดของคุณยังรอลงขายอยู่ — Your CardStreet listings are waiting',
        'เตือนครั้งสุดท้าย: ตั้งค่าการรับเงินให้เสร็จ — Last reminder: finish your payout setup',
    ];
    const thBodies = [
        'คุณเริ่มตั้งค่าการรับเงินบน CardStreet ไว้แล้วแต่ยังไม่เสร็จ — ' +
            'เหลืออีกเพียงไม่กี่ขั้นตอนก็พร้อมลงขายการ์ด และรับเงินเข้าบัญชีธนาคารของคุณโดยตรง',
        'คุณยังตั้งค่าการรับเงินไม่เสร็จ จึงยังลงขายการ์ดไม่ได้ ' +
            'ทำให้เสร็จวันนี้แล้วเริ่มขายได้เลย',
        'นี่เป็นการเตือนครั้งสุดท้ายเรื่องการตั้งค่าการรับเงินของคุณ ' +
            'ทำให้เสร็จเมื่อไหร่ก็เริ่มลงขายการ์ดและรับเงินได้ทันที',
    ];
    const enBodies = [
        'You started setting up payouts on CardStreet but didn\'t finish — only a few ' +
            'steps remain before you can list cards for sale and get paid directly to your bank account.',
        'Your payout setup is still unfinished, so you can\'t list cards yet. ' +
            'Finish it today and you can start selling right away.',
        'This is our last reminder about your payout setup. Finish it whenever you\'re ' +
            'ready and you can list cards and get paid straight away.',
    ];
    // One tray-sized line per touch — the email paragraphs above never reach
    // the push channel (see emailPlusPushContent).
    const pushBodies = [
        'เหลืออีกไม่กี่ขั้นตอน — แตะเพื่อทำต่อ · A few steps left — tap to finish.',
        'ทำให้เสร็จวันนี้แล้วเริ่มลงขายได้เลย · Finish today and start selling.',
        'เตือนครั้งสุดท้าย — แตะเพื่อทำให้เสร็จ · Last reminder — tap to finish.',
    ];

    const i = Math.min(Math.max(touch, 1), titles.length) - 1;
    return {
        title: titles[i],
        thBody: `${thHi}${thBodies[i]}\n\n${thPrep}`,
        enBody: `${enHi}${enBodies[i]}\n\n${enPrep}`,
        pushBody: pushBodies[i],
    };
}

/**
 * "Finish your payout setup" nudge for sellers who created a Stripe connected
 * account but abandoned the hosted onboarding (details never submitted).
 * Candidates are selected by the daily cron (app/api/cron/stripe-setup-nudge);
 * this function re-verifies eligibility so a seller who finished onboarding
 * between the cron's query and the send is never nudged.
 *
 * Sends a SEQUENCE, not a single email: up to NUDGE_MAX_TOUCHES touches spaced
 * at least NUDGE_MIN_SPACING_MS apart, over email + push. Idempotency is a CAS
 * on profiles.stripe_setup_nudge_count (claim `count = old+1 WHERE count = old`
 * before sending, roll both fields back if the send fails), so concurrent cron
 * runs can never double-send and the sequence is bounded.
 *
 * The CTA deep-links to /?stripe_connect=refresh, which the mobile shell +
 * Profile + StripeConnectSection turn into a resume of the hosted flow — now
 * via the prep pre-screen rather than a cold hand-off to Stripe. On a phone
 * with the app installed, cardstreet.app App-Links into the native app.
 *
 * Fails soft (returns 'skipped') if the 20260716_stripe_nudge_sequence
 * migration hasn't been applied yet.
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
            .select('display_name, stripe_account_id, stripe_details_submitted, stripe_charges_enabled, stripe_setup_nudge_sent_at, stripe_setup_nudge_count')
            .eq('id', userId)
            .single();

        if (profileErr || !profile) {
            if (profileErr && /column|does not exist/i.test(profileErr.message || '')) {
                console.warn('[Courier] setup-nudge: awaiting migration 20260716_stripe_nudge_sequence — skipping');
                return 'skipped';
            }
            console.error(`[Courier] ❌ setup-nudge: failed to load profile ${userId}:`, profileErr);
            return 'error';
        }
        if (
            !profile.stripe_account_id ||
            profile.stripe_details_submitted === true ||
            profile.stripe_charges_enabled === true
        ) {
            return 'skipped';
        }

        // ── 2. Sequence position: stop at the cap, respect the spacing. ──
        const touchesSent: number = profile.stripe_setup_nudge_count ?? 0;
        if (touchesSent >= NUDGE_MAX_TOUCHES) return 'skipped';

        const lastSentAt: string | null = profile.stripe_setup_nudge_sent_at ?? null;
        if (lastSentAt && Date.now() - new Date(lastSentAt).getTime() < NUDGE_MIN_SPACING_MS) {
            return 'skipped';
        }

        // ── 3. Resolve the seller's email + push token. ──
        const { data: { user }, error: authErr } = await supabaseAdmin.auth.admin.getUserById(userId);
        const email = (!authErr && user?.email) ? user.email : null;
        if (!email) {
            console.warn(`[Courier] ⚠️  No email for seller ${userId} — skipping setup nudge`);
            return 'skipped';
        }
        // Read the token through the injected client rather than
        // getUserNotifContext(), which always uses the real admin client and
        // would bypass deps in tests.
        const { data: notifPrefs } = await supabaseAdmin
            .from('notification_preferences')
            .select('fcm_token')
            .eq('user_id', userId)
            .maybeSingle();
        const fcmToken: string | null = notifPrefs?.fcm_token || null;

        // ── 4. Atomically claim this touch (CAS on the count we just read). ──
        const claimedAt = new Date().toISOString();
        const { data: claimed, error: claimErr } = await supabaseAdmin
            .from('profiles')
            .update({
                stripe_setup_nudge_count: touchesSent + 1,
                stripe_setup_nudge_sent_at: claimedAt,
            })
            .eq('id', userId)
            .eq('stripe_setup_nudge_count', touchesSent)
            .select('id');

        if (claimErr) {
            console.error(`[Courier] ❌ setup-nudge: claim update failed for ${userId}:`, claimErr);
            return 'error';
        }
        if (!claimed || claimed.length === 0) {
            return 'skipped'; // lost the race to a concurrent run
        }

        // ── 5. Send. Roll the claim back on failure so a later run retries. ──
        const touch = touchesSent + 1;
        const resumeUrl = `${appBaseUrl()}/?stripe_connect=refresh`;
        const supportEmail = (process.env.CARDSTREET_SUPPORT_EMAIL || 'support@thailandtcg.com').trim();
        const firstName = (profile.display_name || '').trim().split(/\s+/)[0];
        const { title, thBody, enBody, pushBody } = stripeNudgeCopy(touch, firstName);

        try {
            const sendResult = await courier.send.message({
                message: {
                    to: buildRecipient(email, fcmToken),
                    content: emailPlusPushContent({
                        title,
                        emailParagraphs: [
                            { text: thBody },
                            { text: enBody, muted: true },
                        ],
                        cta: { label: 'ทำต่อเลย · Resume setup', url: resumeUrl },
                        emailFooter: `มีคำถาม? ติดต่อ ${supportEmail} · Questions? Contact ${supportEmail}`,
                        pushBody,
                    }),
                    routing: buildRouting(true, !!fcmToken, 'inline'),
                    data: { type: 'stripe_setup_nudge', touch },
                    // Thai-first subject exceeds Courier's 48-byte encoded-word
                    // cliff (see SUBJECTS) — force the full subject at Postmark.
                    providers: postmarkOverride(title),
                },
            });
            console.log(
                `[Courier] ✅ Stripe setup reminder (touch ${touch}/${NUDGE_MAX_TOUCHES}) sent to ${userId}. ` +
                `Request ID: ${(sendResult as { requestId?: string })?.requestId ?? 'n/a'}`,
            );
            return 'sent';
        } catch (sendErr) {
            console.error(`[Courier] ❌ Error sending Stripe setup reminder to ${userId}:`, sendErr);
            const { error: rollbackErr } = await supabaseAdmin
                .from('profiles')
                .update({
                    stripe_setup_nudge_count: touchesSent,
                    stripe_setup_nudge_sent_at: lastSentAt,
                })
                .eq('id', userId)
                .eq('stripe_setup_nudge_count', touchesSent + 1)
                .eq('stripe_setup_nudge_sent_at', claimedAt);
            if (rollbackErr) {
                console.error(`[Courier] ❌ setup-nudge: failed to roll back claim for ${userId} (touch will not retry):`, rollbackErr);
            }
            return 'error';
        }
    } catch (err) {
        console.error(`[Courier] ❌ Unexpected error in Stripe setup reminder for ${userId}:`, err);
        return 'error';
    }
}

// ─── First-listing activation nudge (verified sellers) ───────────────────────

/**
 * One-time "you're all set — list your first card" email/push for a seller who
 * FINISHED Stripe onboarding (charges_enabled) but never created a listing.
 * The other half of the funnel: 21 of 34 fully-verified sellers had zero
 * listings as of 2026-07-30 — the KYC wall wasn't their problem, activation is.
 *
 * Candidates are picked by app/api/cron/first-listing-nudge; this function
 * re-verifies eligibility (a listing created between the cron's query and the
 * send cancels the nudge). One touch ever, CAS on
 * profiles.first_listing_nudge_sent_at exactly like the original one-shot
 * setup nudge. Fails soft until 20260730_first_listing_nudge.sql is applied.
 *
 * The CTA links /?view=vault: the web landing branch and the appUrlOpen
 * deep-link branch in components/MobileHome.tsx both land it on the Vault tab,
 * where "New Listing" lives.
 */
export async function sendFirstListingNudgeEmail(
    userId: string,
    deps: FirstTimeSaleDeps = {},
): Promise<'sent' | 'skipped' | 'error'> {
    const courier = deps.courier !== undefined ? deps.courier : getCourier();
    if (!courier) {
        console.warn('[Courier] Client not initialized — skipping first-listing nudge');
        return 'skipped';
    }
    const supabaseAdmin = deps.supabaseAdmin ?? getSupabaseAdmin();

    try {
        // ── 1. Re-verify eligibility. ──
        const { data: profile, error: profileErr } = await supabaseAdmin
            .from('profiles')
            .select('display_name, stripe_charges_enabled, first_listing_nudge_sent_at')
            .eq('id', userId)
            .single();

        if (profileErr || !profile) {
            if (profileErr && /column|does not exist/i.test(profileErr.message || '')) {
                console.warn('[Courier] first-listing nudge: awaiting migration 20260730_first_listing_nudge — skipping');
                return 'skipped';
            }
            console.error(`[Courier] ❌ first-listing nudge: failed to load profile ${userId}:`, profileErr);
            return 'error';
        }
        if (profile.stripe_charges_enabled !== true || profile.first_listing_nudge_sent_at) {
            return 'skipped';
        }

        // Any listing row — active, draft, sold or cancelled — means the
        // seller has activated before and needs no nudge.
        const { count: listingCount, error: listingErr } = await supabaseAdmin
            .from('listings')
            .select('id', { count: 'exact', head: true })
            .eq('seller_id', userId);
        if (listingErr) {
            console.error(`[Courier] ❌ first-listing nudge: listings check failed for ${userId}:`, listingErr);
            return 'error';
        }
        if ((listingCount ?? 0) > 0) return 'skipped';

        // ── 2. Resolve email + push token. ──
        const { data: { user }, error: authErr } = await supabaseAdmin.auth.admin.getUserById(userId);
        const email = (!authErr && user?.email) ? user.email : null;
        if (!email) {
            console.warn(`[Courier] ⚠️  No email for seller ${userId} — skipping first-listing nudge`);
            return 'skipped';
        }
        const { data: notifPrefs } = await supabaseAdmin
            .from('notification_preferences')
            .select('fcm_token')
            .eq('user_id', userId)
            .maybeSingle();
        const fcmToken: string | null = notifPrefs?.fcm_token || null;

        // ── 3. Atomically claim the one-shot slot. ──
        const claimedAt = new Date().toISOString();
        const { data: claimed, error: claimErr } = await supabaseAdmin
            .from('profiles')
            .update({ first_listing_nudge_sent_at: claimedAt })
            .eq('id', userId)
            .is('first_listing_nudge_sent_at', null)
            .select('id');

        if (claimErr) {
            console.error(`[Courier] ❌ first-listing nudge: claim failed for ${userId}:`, claimErr);
            return 'error';
        }
        if (!claimed || claimed.length === 0) {
            return 'skipped'; // lost the race to a concurrent run
        }

        // ── 4. Send. Roll the claim back on failure so a later run retries. ──
        const vaultUrl = `${appBaseUrl()}/?view=vault`;
        const supportEmail = (process.env.CARDSTREET_SUPPORT_EMAIL || 'support@thailandtcg.com').trim();
        const firstName = (profile.display_name || '').trim().split(/\s+/)[0];
        const title = 'บัญชีพร้อมขายแล้ว — You\'re verified, list your first card';

        try {
            const sendResult = await courier.send.message({
                message: {
                    to: buildRecipient(email, fcmToken),
                    content: emailPlusPushContent({
                        title,
                        emailParagraphs: [
                            {
                                text:
                                    `${firstName ? `สวัสดีคุณ ${firstName},\n\n` : ''}` +
                                    'การตั้งค่าการรับเงินของคุณเสร็จสมบูรณ์แล้ว — ตอนนี้ลงขายการ์ดได้เลย ' +
                                    'สแกนการ์ดเข้าคลังแล้วกด "ประกาศขายใหม่" ก็เริ่มขายได้ทันที เงินจากการขายเข้าบัญชีธนาคารของคุณโดยตรง',
                            },
                            {
                                text:
                                    `${firstName ? `Hi ${firstName},\n\n` : ''}` +
                                    'Your payout setup is complete — you can sell now. Scan cards into your vault, ' +
                                    'tap "New Listing", and the money from every sale goes straight to your bank account.',
                                muted: true,
                            },
                        ],
                        cta: { label: 'ลงขายการ์ดใบแรก · List your first card', url: vaultUrl },
                        emailFooter: `มีคำถาม? ติดต่อ ${supportEmail} · Questions? Contact ${supportEmail}`,
                        pushBody: 'สแกนการ์ดเข้าคลังแล้วกด "ประกาศขายใหม่" ได้เลย · Scan a card and tap New Listing.',
                    }),
                    routing: buildRouting(true, !!fcmToken, 'inline'),
                    data: { type: 'first_listing_nudge' },
                    // Thai-first subject exceeds Courier's 48-byte encoded-word
                    // cliff (see SUBJECTS) — force the full subject at Postmark.
                    providers: postmarkOverride(title),
                },
            });
            console.log(
                `[Courier] ✅ First-listing nudge sent to ${userId}. ` +
                `Request ID: ${(sendResult as { requestId?: string })?.requestId ?? 'n/a'}`,
            );
            return 'sent';
        } catch (sendErr) {
            console.error(`[Courier] ❌ Error sending first-listing nudge to ${userId}:`, sendErr);
            const { error: rollbackErr } = await supabaseAdmin
                .from('profiles')
                .update({ first_listing_nudge_sent_at: null })
                .eq('id', userId)
                .eq('first_listing_nudge_sent_at', claimedAt);
            if (rollbackErr) {
                console.error(`[Courier] ❌ first-listing nudge: rollback failed for ${userId} (will not retry):`, rollbackErr);
            }
            return 'error';
        }
    } catch (err) {
        console.error(`[Courier] ❌ Unexpected error in first-listing nudge for ${userId}:`, err);
        return 'error';
    }
}

// ─── Abandoned-checkout recovery nudge (buyer) ───────────────────────────────

/**
 * One-time "you didn't finish — the card's still available" email/push for a
 * buyer whose checkout was abandoned (order cancelled, never paid). The buyer
 * side of the seller onboarding nudge: /api/orders/checkout reserves the
 * listing before charging, and an unpaid checkout (a PromptPay QR left
 * unscanned, a closed payment sheet) is later cancelled by the reconcile cron
 * or the webhook, freeing the listing. This re-engages the buyer while their
 * intent is still warm and points them straight back to the (now buyable
 * again) card.
 *
 * Candidates are picked by app/api/cron/buyer-payment-nudge; this function
 * re-verifies eligibility so a buyer who already re-bought (or whose card sold
 * to someone else) is never nudged wrongly.
 *
 * Idempotency mirrors sendStripeSetupReminderEmail: CLAIM
 * orders.checkout_nudge_sent_at (CAS on NULL) before sending, roll the claim
 * back only if the actual send fails. The claim is kept when we deliberately
 * decline to send (listing no longer active, no contact channel) so the cron
 * never reconsiders a settled order. Never throws.
 *
 * Copy is inline + bilingual (TH first — the server can't know the buyer's UI
 * language). The CTA deep-links to /card/<id>, which resolves on desktop, on
 * the mobile web shell (?card= overlay), and App-Links into the native app.
 */
export async function sendAbandonedCheckoutNudge(
    orderId: string,
    deps: FirstTimeSaleDeps = {},
): Promise<'sent' | 'skipped' | 'error'> {
    const courier = deps.courier !== undefined ? deps.courier : getCourier();
    if (!courier) {
        console.warn('[Courier] Client not initialized — skipping checkout nudge');
        return 'skipped';
    }
    const supabaseAdmin = deps.supabaseAdmin ?? getSupabaseAdmin();

    try {
        // ── 1. Re-verify the order is a genuine abandoned, un-nudged checkout. ──
        // This `orderId` is the representative for its cart; the claim below
        // covers the whole transfer_group so a multi-item cart nudges once.
        const { data: order, error: orderErr } = await supabaseAdmin
            .from('orders')
            .select('id, buyer_id, listing_id, transfer_group, status, payment_id, checkout_nudge_sent_at')
            .eq('id', orderId)
            .single();

        if (orderErr || !order) {
            console.error(`[Courier] ❌ checkout-nudge: failed to load order ${orderId}:`, orderErr);
            return 'error';
        }
        if (
            order.status !== 'cancelled' ||
            order.payment_id ||
            order.checkout_nudge_sent_at ||
            !order.listing_id ||
            !order.buyer_id ||
            !order.transfer_group
        ) {
            return 'skipped';
        }

        // ── 2. The card the buyer was trying to buy — needed for the CTA and
        //       to confirm there's still something to recover. ──
        const { data: listing } = await supabaseAdmin
            .from('listings')
            .select('id, status, card_id, card_data')
            .eq('id', order.listing_id)
            .single();

        // ── 3. Resolve the buyer's channels (default-on, like payout/delivered). ──
        const { email, fcmToken, prefs } = await getUserNotifContext(order.buyer_id);
        const wantEmail = prefs.checkout_nudge_email !== false && !!email;
        const wantPush = prefs.checkout_nudge_push !== false && !!fcmToken;

        // ── 4. Atomically claim the one-shot slot for the WHOLE cart. ──
        // Claiming by transfer_group (not just this row) means a multi-item
        // single-seller cart — which becomes one cancelled order per card — is
        // stamped in one shot, so the buyer gets a single nudge, not one per
        // card. The status/payment guards keep us from ever stamping a sibling
        // that somehow got paid.
        const claimedAt = new Date().toISOString();
        const { data: claimed, error: claimErr } = await supabaseAdmin
            .from('orders')
            .update({ checkout_nudge_sent_at: claimedAt })
            .eq('transfer_group', order.transfer_group)
            .eq('status', 'cancelled')
            .is('payment_id', null)
            .is('checkout_nudge_sent_at', null)
            .select('id');

        if (claimErr) {
            console.error(`[Courier] ❌ checkout-nudge: claim update failed for ${orderId}:`, claimErr);
            return 'error';
        }
        if (!claimed || claimed.length === 0) {
            return 'skipped'; // lost the race to a concurrent run
        }

        // The claim is now ours. Decline (keeping the claim) when there's
        // nothing to recover or no way to reach the buyer — these are terminal,
        // not retryable, so we intentionally do NOT roll the claim back.
        if (!listing || listing.status !== 'active') return 'skipped';
        if (!wantEmail && !wantPush) return 'skipped';

        // ── 5. Build payload + send. ──
        const cardId: string | null = listing.card_id ?? null;
        const cardName = ((listing.card_data as any)?.name || '').toString().trim() || 'the card';
        const cardUrl = cardId ? `${appBaseUrl()}/card/${cardId}` : `${appBaseUrl()}/`;
        const supportEmail = (process.env.CARDSTREET_SUPPORT_EMAIL || 'support@thailandtcg.com').trim();

        const recipient = buildRecipient(wantEmail ? email : null, wantPush ? fcmToken : null);
        const routing = buildRouting(wantEmail, wantPush, 'inline');
        if (routing.channels.length === 0) return 'skipped';

        try {
            const title = `ยังซื้อ ${cardName} ได้อยู่ — Still want ${cardName}?`;
            const sendResult = await courier.send.message({
                message: {
                    to: recipient,
                    content: emailPlusPushContent({
                        title,
                        emailParagraphs: [
                            {
                                text:
                                    `คุณเริ่มสั่งซื้อ "${cardName}" ไว้แต่การชำระเงินยังไม่เสร็จ — ` +
                                    'การ์ดใบนี้ยังมีอยู่และพร้อมให้คุณซื้อให้เสร็จก่อนใคร',
                            },
                            {
                                text:
                                    `You started buying "${cardName}" but the payment didn't go through — ` +
                                    'good news, it\'s still available. Complete your purchase before someone else grabs it.',
                                muted: true,
                            },
                        ],
                        cta: { label: 'ซื้อให้เสร็จ · Complete purchase', url: cardUrl },
                        emailFooter: `ติดขัดตรงไหน? ติดต่อ ${supportEmail} · Need a hand? Contact ${supportEmail}`,
                        pushBody: 'การ์ดยังว่างอยู่ — แตะเพื่อซื้อให้เสร็จ · Still available — tap to finish checkout.',
                    }),
                    routing,
                    // Push deep-link payload (read by the mobile FCM handler).
                    data: {
                        type: 'checkout_incomplete',
                        orderId,
                        listingId: listing.id,
                        ...(cardId ? { cardId } : {}),
                    },
                    // Thai-first subject exceeds Courier's 48-byte encoded-word
                    // cliff (see SUBJECTS) — force the full subject at Postmark.
                    providers: postmarkOverride(title),
                },
            });
            console.log(
                `[Courier] ✅ Checkout nudge sent to buyer ${order.buyer_id} (order ${orderId}). ` +
                `Request ID: ${(sendResult as { requestId?: string })?.requestId ?? 'n/a'}`,
            );
            return 'sent';
        } catch (sendErr) {
            console.error(`[Courier] ❌ Error sending checkout nudge for ${orderId}:`, sendErr);
            // Send failed — roll the whole cart's claim back so a later run
            // retries. Guard on our own timestamp so we never clobber a newer
            // claim, and scope to the transfer_group we just claimed.
            const { error: rollbackErr } = await supabaseAdmin
                .from('orders')
                .update({ checkout_nudge_sent_at: null })
                .eq('transfer_group', order.transfer_group)
                .eq('checkout_nudge_sent_at', claimedAt);
            if (rollbackErr) {
                console.error(`[Courier] ❌ checkout-nudge: failed to roll back claim for ${orderId} (will not retry):`, rollbackErr);
            }
            return 'error';
        }
    } catch (err) {
        console.error(`[Courier] ❌ Unexpected error in checkout nudge for ${orderId}:`, err);
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

    const priceLabel = `฿${Number(listing.price).toLocaleString('en-US')}`;
    // Resolved before the routing below: which branch we take decides how the
    // push channel must be addressed (see buildRouting).
    const templateId = (process.env.COURIER_WISHLIST_ALERT_TEMPLATE_ID || '').trim();
    const routing = buildRouting(wantEmail, wantPush, templateId ? 'template' : 'inline');

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
        // Title already carries card + price — the body only adds the source
        // and the action. One short line serves both channels.
        message.content = {
            title: `${listing.cardName} just listed — ${priceLabel}`,
            body: `จาก Wishlist ของคุณ (${listing.condition}) — แตะเพื่อดูก่อนใคร · From your wishlist — tap to see it first.`,
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

/**
 * Show URL with GA attribution. Without these params every push/email arrival
 * lands as Direct traffic and a show's reach can't be judged after the fact —
 * the 2026-08-18 retro could not tell how many of 315 pushes were tapped.
 * medium: 'push' / 'email' for the single-channel blasts; 'alert' for the
 * targeted email+push sends (one Courier message covers both channels, so
 * they can't carry different URLs).
 */
function showUrlWithUtm(
    streamId: string,
    medium: 'push' | 'email' | 'alert',
    campaign: 'live_golive' | 'live_prestart' | 'live_announce',
): string {
    return `${APP_URL}/live/${streamId}?utm_source=courier&utm_medium=${medium}&utm_campaign=${campaign}`;
}

/**
 * Live-breaks presales: tells a buyer who bought presale spots that the show
 * they reserved a seat in just went live. Mirrors sendWishlistListingAlert —
 * inline bilingual content until a dashboard template exists (set
 * COURIER_SHOW_LIVE_TEMPLATE_ID to switch), prefs default ON, never throws.
 */
export async function sendShowLiveNotification(
    userId: string,
    show: { streamId: string; title: string; reason?: 'presale' | 'reminder' },
): Promise<boolean> {
    const courier = getCourier();
    if (!courier) { console.warn('[Courier] Client not initialized — skipping show-live alert'); return false; }

    const { email, fcmToken, prefs } = await getUserNotifContext(userId);
    // `!== false` so accounts without the show_live_* pref columns (or no
    // prefs row) default to ON, like the other alerts.
    const wantEmail = prefs.show_live_email !== false && !!email;
    const wantPush = prefs.show_live_push !== false && !!fcmToken;
    if (!wantEmail && !wantPush) return false;

    const recipient = buildRecipient(wantEmail ? email : null, wantPush ? fcmToken : null);
    // Resolved before the routing below: which branch we take decides how the
    // push channel must be addressed (see buildRouting).
    const templateId = (process.env.COURIER_SHOW_LIVE_TEMPLATE_ID || '').trim();
    const routing = buildRouting(wantEmail, wantPush, templateId ? 'template' : 'inline');
    const showUrl = showUrlWithUtm(show.streamId, 'alert', 'live_golive');

    const message: Record<string, unknown> = {
        to: recipient,
        routing,
        data: {
            title: show.title,
            showUrl,
            // Push deep-link payload (read by the mobile FCM handler).
            streamId: show.streamId,
            type: 'stream_live',
        },
    };
    if (templateId) {
        message.template = templateId;
    } else {
        // A reminder subscriber never reserved anything — saying they did
        // would read as a mistake and undercut the alert. The show URL lives
        // in the email CTA and the push `data` payload only — never in the
        // visible body (the tap deep-links; a pasted UTM URL just reads as
        // clutter in a tray).
        const title = `LIVE now — ${show.title}`;
        message.content = emailPlusPushContent({
            title,
            emailParagraphs: [
                {
                    text:
                        show.reason === 'reminder'
                            ? `${show.title} — the show you asked to be reminded about — is live on CardStreet right now.`
                            : `${show.title} — the show you reserved a spot in — is live on CardStreet right now.`,
                },
                {
                    text:
                        show.reason === 'reminder'
                            ? `ไลฟ์ ${show.title} ที่คุณกดแจ้งเตือนไว้เริ่มแล้ว — เข้ามาดูได้เลย`
                            : `ไลฟ์ ${show.title} ที่คุณจองสปอตไว้เริ่มแล้ว — เข้ามาดูได้เลย`,
                    muted: true,
                },
            ],
            cta: { label: 'Watch now / ดูไลฟ์เลย', url: showUrl },
            pushBody:
                show.reason === 'reminder'
                    ? 'ไลฟ์ที่คุณกดแจ้งเตือนไว้เริ่มแล้ว — แตะเพื่อดู · Tap to watch.'
                    : 'ไลฟ์ที่คุณจองสปอตไว้เริ่มแล้ว — แตะเพื่อดู · Your show has started — tap to watch.',
        });
        // Thai show titles push the subject past Courier's 48-byte encoded-word
        // cliff (see SUBJECTS) — force the full subject at Postmark.
        message.providers = postmarkOverride(title);
    }

    try {
        const sendResult = await courier.send.message({ message: message as any });
        console.log(`[Courier] ✅ Show-live alert sent to ${userId} for stream ${show.streamId}. Request ID: ${(sendResult as { requestId?: string })?.requestId ?? 'n/a'}`);
        return true;
    } catch (error) {
        console.error(`[Courier] ❌ Error sending show-live alert to ${userId}:`, error);
        return false;
    }
}

/**
 * "Starts in N minutes" heads-up to a Get-notified subscriber. Same delivery
 * shape as the go-live alert (email + push, prefs default ON, never throws) —
 * only the copy and the deep-link intent differ: this one is a calendar nudge,
 * the go-live one is a watch-now alert, and a subscriber gets both.
 */
export async function sendShowStartingSoonNotification(
    userId: string,
    show: { streamId: string; title: string; minutes: number },
): Promise<boolean> {
    const courier = getCourier();
    if (!courier) { console.warn('[Courier] Client not initialized — skipping starting-soon alert'); return false; }

    const { email, fcmToken, prefs } = await getUserNotifContext(userId);
    // Shares the show_live_* prefs: someone who muted show alerts does not
    // want the heads-up either.
    const wantEmail = prefs.show_live_email !== false && !!email;
    const wantPush = prefs.show_live_push !== false && !!fcmToken;
    if (!wantEmail && !wantPush) return false;

    const recipient = buildRecipient(wantEmail ? email : null, wantPush ? fcmToken : null);
    const templateId = (process.env.COURIER_SHOW_SOON_TEMPLATE_ID || '').trim();
    const routing = buildRouting(wantEmail, wantPush, templateId ? 'template' : 'inline');
    const showUrl = showUrlWithUtm(show.streamId, 'alert', 'live_prestart');

    const message: Record<string, unknown> = {
        to: recipient,
        routing,
        data: {
            title: show.title,
            showUrl,
            minutes: show.minutes,
            streamId: show.streamId,
            type: 'stream_starting_soon',
        },
    };
    if (templateId) {
        message.template = templateId;
    } else {
        // Signal-first title (trays truncate the tail of long Thai titles);
        // URL only in the email CTA + push `data`, never the visible body.
        const title = `Starts in ${show.minutes} min — ${show.title}`;
        message.content = emailPlusPushContent({
            title,
            emailParagraphs: [
                { text: `${show.title} — the show you asked to be reminded about — starts in about ${show.minutes} minutes on CardStreet.` },
                { text: `ไลฟ์ ${show.title} ที่คุณกดแจ้งเตือนไว้กำลังจะเริ่มในอีกประมาณ ${show.minutes} นาที`, muted: true },
            ],
            cta: { label: 'Watch now / ดูไลฟ์เลย', url: showUrl },
            pushBody: 'ไลฟ์ที่คุณกดแจ้งเตือนไว้กำลังจะเริ่ม — แตะเพื่อเข้าดู · Tap to watch.',
        });
        message.providers = postmarkOverride(title);
    }

    try {
        await courier.send.message({ message: message as any });
        return true;
    } catch (error) {
        console.error(`[Courier] ❌ Error sending starting-soon alert to ${userId}:`, error);
        return false;
    }
}

/**
 * Show PUSH blast to every app install — the "we're live" announcement
 * (kind 'golive', the default) or the day-ahead heads-up for a scheduled show
 * (kind 'announce', sent by the show-reminders cron). Exclude the seller and
 * anyone who already got the richer targeted alert (presale buyers, reminder
 * subscribers) via excludeUserIds.
 *
 * One paged query over notification_preferences (fcm_token holders only,
 * PostgREST's 1000-row cap respected), show_live_push honored (default ON),
 * sends fanned out in small chunks. Best-effort per recipient: one dead token
 * must never stop the blast. Returns the dispatched count.
 */
export async function sendShowLivePushBlast(
    show: { streamId: string; title: string; startsAtLabel?: string },
    excludeUserIds: string[],
    kind: 'golive' | 'announce' = 'golive',
): Promise<number> {
    const courier = getCourier();
    if (!courier) {
        console.warn('[Courier] Client not initialized — skipping show-live blast');
        return 0;
    }
    const supabaseAdmin = getSupabaseAdmin();
    const excluded = new Set(excludeUserIds);
    const showUrl = showUrlWithUtm(
        show.streamId,
        'push',
        kind === 'announce' ? 'live_announce' : 'live_golive',
    );
    const templateId = (
        (kind === 'announce'
            ? process.env.COURIER_SHOW_ANNOUNCE_TEMPLATE_ID
            : process.env.COURIER_SHOW_LIVE_TEMPLATE_ID) || ''
    ).trim();

    // ─── Collect recipients (paged — .limit() alone silently caps at 1000) ───
    interface PrefRow {
        user_id: string;
        fcm_token: string | null;
        show_live_push?: boolean | null;
    }
    const recipients: { userId: string; fcmToken: string }[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabaseAdmin
            .from('notification_preferences')
            .select('*')
            .not('fcm_token', 'is', null)
            .order('user_id', { ascending: true })
            .range(from, from + PAGE - 1)
            .returns<PrefRow[]>();
        if (error) {
            console.error('[Courier] show-live blast recipient query failed:', error.message);
            break;
        }
        for (const row of data ?? []) {
            if (!row.fcm_token || excluded.has(row.user_id)) continue;
            // Absent column / no explicit opt-out = ON, like every other alert.
            if (row.show_live_push === false) continue;
            recipients.push({ userId: row.user_id, fcmToken: row.fcm_token });
        }
        if (!data || data.length < PAGE) break;
    }
    if (recipients.length === 0) return 0;

    // ─── Fan out in bounded chunks ───
    let sent = 0;
    const CHUNK = 10;
    for (let i = 0; i < recipients.length; i += CHUNK) {
        const chunk = recipients.slice(i, i + CHUNK);
        const results = await Promise.allSettled(
            chunk.map(async ({ userId, fcmToken }) => {
                const message: Record<string, unknown> = {
                    // user_id rides along so Courier's message log reports a
                    // failed send against OUR user id — without it the log
                    // shows an opaque anon_* profile and a dead token can
                    // never be traced back for pruning (2026-08-18: 45/360
                    // blast pushes hit dead tokens, none identifiable).
                    // scripts/prune-dead-fcm-tokens.mjs reads that log.
                    to: { ...buildRecipient(null, fcmToken), user_id: userId },
                    routing: buildRouting(false, true, templateId ? 'template' : 'inline'),
                    data: {
                        title: show.title,
                        showUrl,
                        streamId: show.streamId,
                        type: kind === 'announce' ? 'stream_announce' : 'stream_live',
                    },
                };
                if (templateId) {
                    message.template = templateId;
                } else if (kind === 'announce') {
                    // Signal-first, like the email subject: notification trays
                    // truncate even harder than inbox list views. The show URL
                    // rides only in `data` (tap deep-link + GA attribution) —
                    // a pasted UTM URL in the visible body reads as clutter.
                    const when = show.startsAtLabel?.replace(/\s*\(Bangkok time\)\s*$/i, '');
                    message.content = {
                        title: when
                            ? `Live ${when} — ${show.title}`
                            : `Going live soon — ${show.title}`,
                        body: 'แตะเพื่อดูรายละเอียดและรับแจ้งเตือนเมื่อไลฟ์เริ่ม · Tap to see the show and get a start reminder.',
                    };
                } else {
                    message.content = {
                        title: `LIVE now — ${show.title}`,
                        body: 'ดูไลฟ์ได้เลยตอนนี้ — แตะเพื่อเข้าดู · Watch the live break now.',
                    };
                }
                await courier.send.message({ message: message as any });
                return userId;
            }),
        );
        sent += results.filter((r) => r.status === 'fulfilled').length;
    }
    console.log(
        `[Courier] show ${kind} blast for ${show.streamId}: ${sent}/${recipients.length} pushes dispatched`,
    );
    return sent;
}

/**
 * Show EMAIL blast to every account with a usable address.
 *
 * The push blast was originally push-ONLY by design (email-on-every-go-live
 * read as spam risk). At the 2026-08-18 show the founder hand-sent exactly
 * this email to all users — 9 minutes after going live — and asked for it to
 * be automated, so the decision is reversed for PUBLIC shows: kind 'golive'
 * fires from the go-live route at flip time, kind 'announce' from the
 * show-reminders cron a day ahead. Unlisted shows never blast.
 *
 * Recipient hygiene: synthetic `@partner.cardstreet.app` addresses are
 * skipped (breaker placeholder accounts — 21 guaranteed bounces in the
 * 08-18 manual blast), show_live_email is honored (default ON), and
 * excludeUserIds covers the seller + anyone who already got the richer
 * targeted email. Emails page from the auth admin API (the only place
 * addresses live). Best-effort per recipient; returns the dispatched count.
 */
export async function sendShowEmailBlast(
    show: { streamId: string; title: string; startsAtLabel?: string },
    excludeUserIds: string[],
    kind: 'golive' | 'announce' = 'golive',
): Promise<number> {
    const courier = getCourier();
    if (!courier) {
        console.warn('[Courier] Client not initialized — skipping show email blast');
        return 0;
    }
    const supabaseAdmin = getSupabaseAdmin();
    const excluded = new Set(excludeUserIds);
    const showUrl = showUrlWithUtm(
        show.streamId,
        'email',
        kind === 'announce' ? 'live_announce' : 'live_golive',
    );
    const templateId = (
        (kind === 'announce'
            ? process.env.COURIER_SHOW_ANNOUNCE_TEMPLATE_ID
            : process.env.COURIER_SHOW_LIVE_TEMPLATE_ID) || ''
    ).trim();

    // ─── Email opt-outs (paged; column may predate its migration → default ON) ───
    const optedOut = new Set<string>();
    {
        const PAGE = 1000;
        for (let from = 0; ; from += PAGE) {
            const { data, error } = await supabaseAdmin
                .from('notification_preferences')
                .select('*')
                .order('user_id', { ascending: true })
                .range(from, from + PAGE - 1)
                .returns<{ user_id: string; show_live_email?: boolean | null }[]>();
            if (error) {
                console.warn('[Courier] show email blast prefs query failed:', error.message);
                break;
            }
            for (const row of data ?? []) {
                if (row.show_live_email === false) optedOut.add(row.user_id);
            }
            if (!data || data.length < PAGE) break;
        }
    }

    // ─── Collect addresses from the auth admin API (paged) ───
    const recipients: { userId: string; email: string }[] = [];
    for (let page = 1; page <= 30; page++) {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({
            page,
            perPage: 1000,
        });
        if (error) {
            console.error('[Courier] show email blast user listing failed:', error.message);
            break;
        }
        for (const u of data?.users ?? []) {
            const email = u.email?.trim();
            if (!email || excluded.has(u.id) || optedOut.has(u.id)) continue;
            if (email.toLowerCase().endsWith('@partner.cardstreet.app')) continue;
            recipients.push({ userId: u.id, email });
        }
        if (!data || data.users.length < 1000) break;
    }
    if (recipients.length === 0) return 0;

    // Subject leads with the SIGNAL, not the title: long Thai show titles
    // truncate in inbox list views, so a title-first subject shows only the
    // cut-off title and none of the "live ... 20:30" part (seen on the
    // 2026-08-22 announce). "(Bangkok time)" stays in the body where space
    // is free; the sender name already says CardStreet.
    const subjectWhen = show.startsAtLabel?.replace(/\s*\(Bangkok time\)\s*$/i, '');
    const subject =
        kind === 'announce'
            ? subjectWhen
                ? `Live ${subjectWhen} — ${show.title}`
                : `Coming soon on CardStreet — ${show.title}`
            : `LIVE now — ${show.title}`;
    // Built per recipient, because the unsubscribe link is signed for one
    // user. This is promotional mail going to the whole base — without a way
    // out in the message itself, the only lever a recipient has is the spam
    // button, and that damages the domain we also send order, shipping and
    // payout mail from.
    const buildContent = (unsubUrl: string | null) => ({
        version: '2022-01-01',
        elements: [
            { type: 'meta', title: subject },
            {
                type: 'text',
                content:
                    kind === 'announce'
                        ? `${show.title} goes live on CardStreet ${show.startsAtLabel || 'soon'}. Open the show page and tap "Get notified" so you don't miss the start.`
                        : `${show.title} is live on CardStreet right now — come watch the break and grab a spot.`,
            },
            {
                type: 'text',
                content:
                    kind === 'announce'
                        ? `ไลฟ์ ${show.title} กำลังจะเริ่ม${show.startsAtLabel ? ` ${show.startsAtLabel}` : 'เร็วๆ นี้'} — เปิดหน้าไลฟ์แล้วกด "รับการแจ้งเตือน" เพื่อไม่พลาดตอนเริ่ม`
                        : `ไลฟ์ ${show.title} เริ่มแล้วตอนนี้ — เข้ามาดูและจองสปอตได้เลย`,
                color: '#6b7280',
            },
            {
                type: 'action',
                content: kind === 'announce' ? 'See the show / ดูรายละเอียด' : 'Watch now / ดูไลฟ์เลย',
                href: showUrl,
                style: 'button',
                align: 'center',
                background_color: '#0891b2',
            },
            // Omitted entirely when the token can't be signed — a dead
            // unsubscribe link is worse than none, because it reads as an
            // ignored opt-out.
            ...(unsubUrl
                ? [
                      {
                          type: 'text',
                          content:
                              `ไม่อยากรับอีเมลแจ้งไลฟ์? [ยกเลิกการรับอีเมล](${unsubUrl})` +
                              ` · Don't want live show emails? [Unsubscribe](${unsubUrl}).` +
                              ' Order and shipping emails are unaffected.',
                          align: 'center',
                          color: '#6b7280',
                      },
                  ]
                : []),
        ],
    });

    let sent = 0;
    const CHUNK = 10;
    for (let i = 0; i < recipients.length; i += CHUNK) {
        const chunk = recipients.slice(i, i + CHUNK);
        const results = await Promise.allSettled(
            chunk.map(async ({ userId, email }) => {
                const unsubUrl = unsubscribeUrl(APP_URL, userId, 'show_live_email');
                const message: Record<string, unknown> = {
                    // user_id for bounce traceability, same as the push blast.
                    to: { ...buildRecipient(email, null), user_id: userId },
                    routing: buildRouting(true, false, templateId ? 'template' : 'inline'),
                    data: {
                        title: show.title,
                        showUrl,
                        streamId: show.streamId,
                        type: kind === 'announce' ? 'stream_announce' : 'stream_live',
                        // Also passed to a Courier TEMPLATE, which ignores the
                        // inline content below — the template must render
                        // {{unsubscribeUrl}} or the link exists only on the
                        // inline path.
                        unsubscribeUrl: unsubUrl,
                    },
                };
                if (templateId) {
                    message.template = templateId;
                } else {
                    message.content = buildContent(unsubUrl);
                }
                await courier.send.message({ message: message as any });
            }),
        );
        sent += results.filter((r) => r.status === 'fulfilled').length;
    }
    console.log(
        `[Courier] show ${kind} email blast for ${show.streamId}: ${sent}/${recipients.length} emails dispatched`,
    );
    return sent;
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
 * Branded Courier Elemental content for an offer notification. `meta.title` is
 * the email subject AND the push title; the two long text blocks + CTA button
 * are email-only, and the push channel renders just the short `push` line
 * (see emailPlusPushContent — before that scoping, the CTA button rendered
 * into delivered push bodies as a raw "label: URL" line, verified against
 * Courier's output API 2026-08-27). The Courier default brand wraps the email
 * with the logo / header. Rendering falls to this only when no dashboard
 * template id is set for the event.
 */
function buildOfferEmailContent(c: {
    subject: string; bodyEn: string; bodyTh: string; cta: string; push: string;
    /** Overrides the CTA destination. The accepted-offer mail points straight
     *  at the pay link rather than at the Offers list, which is one more screen
     *  between a buyer who has decided and the payment. */
    ctaUrl?: string;
}) {
    return emailPlusPushContent({
        title: c.subject,
        emailParagraphs: [
            { text: c.bodyEn },
            { text: c.bodyTh, muted: true },
        ],
        cta: { label: c.cta, url: c.ctaUrl ?? `${APP_URL}/?view=offers` },
        pushBody: c.push,
    });
}

/**
 * The shareable pay link for an accepted offer (app/pay/[offerId]/route.ts).
 *
 * Exported because the seller needs it too: the deal is agreed in the app and
 * then chased in LINE, and until now the seller had nothing to send. A link
 * they can paste is the whole difference between "have you paid yet" and a tap.
 */
export function offerPayUrl(offerId: string): string {
    return `${APP_URL}/pay/${offerId}`;
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
        inline: (priceLabel: string, cardName: string) => { subject: string; bodyEn: string; bodyTh: string; cta: string; push: string; ctaUrl?: string };
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
    // The offer templates are unset until the dashboard work lands, so these
    // sends currently take the inline branch below and must pin the FCM
    // provider or the push is dropped (see buildRouting).
    const routing = buildRouting(wantEmail, wantPush, cfg.template ? 'template' : 'inline');
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
            // The pay link, so a template-backed send can use it too and the
            // push tap has a destination that is the payment itself rather than
            // the Offers list.
            payUrl: offerPayUrl(details.offerId),
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
            push: 'แตะเพื่อตอบรับ ต่อรอง หรือปฏิเสธ · Tap to accept, counter, or decline.',
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
            // 48 hours is stated because it is now true: the hourly cron
            // expires accepted offers at that mark. A deadline nobody enforces
            // is worse than none, and one nobody states is not a deadline.
            bodyEn: `Your offer${priceLabel ? ` of ${priceLabel}` : ''} on ${cardName} was accepted. Pay within 48 hours to complete the purchase — the card stays on sale until you do.`,
            bodyTh: `ข้อเสนอของคุณได้รับการตอบรับแล้ว ชำระเงินภายใน 48 ชั่วโมง — การ์ดยังเปิดขายอยู่จนกว่าคุณจะชำระ`,
            cta: 'Pay now · ชำระเงิน',
            push: 'ชำระเงินภายใน 48 ชม. ก่อนมีคนซื้อตัดหน้า · Pay within 48h before someone else buys it.',
            ctaUrl: offerPayUrl(details.offerId),
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
            push: 'ลองเสนอราคาใหม่ได้ทุกเมื่อ · You can make a new offer anytime.',
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
            push: 'แตะเพื่อตอบรับหรือต่อรองกลับ · Tap to accept or counter back.',
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
            push: 'ข้อเสนอหมดอายุหรือสินค้าถูกขายแล้ว · It expired or the listing sold.',
        }),
    });
}

/**
 * The buyer: their accepted offer is still unpaid. Sent by the daily
 * nudge-accepted-offers cron, never on the request path.
 *
 * Rides the `offer_accepted_*` prefs deliberately — a buyer who wants to hear
 * that their offer was accepted wants to hear it's still waiting, and it saves
 * a second pref pair (and a settings row) for the same event.
 */
export async function sendOfferPaymentReminderNotification(
    buyerId: string,
    details: OfferNotifDetails,
): Promise<void> {
    return sendOfferNotification(buyerId, 'accepted', details, {
        emailPref: 'offer_accepted_email',
        pushPref: 'offer_accepted_push',
        template: TEMPLATES.offerPaymentReminder,
        pushType: 'offer_accepted',
        inline: (priceLabel, cardName) => ({
            subject: `Still yours${priceLabel ? ` at ${priceLabel}` : ''} — ${cardName}`,
            // The no-reserve model is the whole reason this reminder exists:
            // the listing stayed buyable the entire time.
            bodyEn: `Your accepted offer${priceLabel ? ` of ${priceLabel}` : ''} on ${cardName} is still waiting for payment. It isn't reserved — another buyer can still take it until you pay.`,
            bodyTh: `ข้อเสนอที่ได้รับการตอบรับของคุณยังรอการชำระเงิน สินค้ายังไม่ถูกจอง — ผู้อื่นซื้อได้จนกว่าคุณจะชำระเงิน`,
            cta: 'Pay now · ชำระเงิน',
            push: 'ยังไม่ถูกจอง — ชำระเงินเพื่อปิดดีล · Not reserved until you pay.',
        }),
    });
}

// ─── Internal ops alert: new breaker application ─────────────────────────────

/**
 * Notifies the CardStreet team when someone applies at /become-a-breaker.
 *
 * Internal ops alert, so it follows sendPartnerActivatedNotification rather
 * than the customer-facing sends above: a single inbox
 * (BREAKER_APPLICATION_NOTIFY_EMAIL, default the founder's address) and inline
 * `content` instead of a Courier template. The "template, never content" rule
 * at the top of this file is about customer mail, where the dashboard owns the
 * copy and the Thai subject needs the Postmark override — neither applies to a
 * plain English alert to ourselves, and a template would be one more thing to
 * author and keep in sync.
 *
 * Body is a triage summary, not the whole application: enough to decide
 * whether to open the review console, with a deep link to it. The long written
 * answers stay in /admin/breakers.
 *
 * Best-effort and never throws — a Courier hiccup must not fail an application
 * that has already been written to the database. The caller fires it via
 * `after()` so the applicant's response isn't waiting on an email.
 */
/**
 * Streak-at-risk nudge. PUSH ONLY, by design.
 *
 * A daily email reminding someone to open an app is spam, and would burn the
 * sender reputation that the order and shipping mail depends on. Push costs
 * nothing, is silent when declined, and is the channel a daily loop belongs on.
 * Accordingly this returns false rather than falling back to email when the
 * user has no token: no token means no nudge, full stop.
 *
 * Content is inline (no Courier template), so routing must name the FCM
 * provider explicitly — see buildRouting: the bare `push` channel resolves to
 * Courier Inbox for inline content and the notification is silently dropped.
 */
export async function sendStreakAtRiskPush(
    userId: string,
    streak: number,
): Promise<boolean> {
    const courier = getCourier();
    if (!courier) return false;

    const { fcmToken, prefs } = await getUserNotifContext(userId);
    if (!fcmToken || prefs.streak_push === false) return false;

    try {
        await courier.send.message({
            message: {
                // user_id rides along so a failed send is traceable back to OUR
                // user id in Courier's log — without it the log shows an opaque
                // anon_* profile and a dead token can never be pruned.
                to: { ...buildRecipient(null, fcmToken), user_id: userId },
                routing: buildRouting(false, true, 'inline'),
                data: { type: 'streak_at_risk', streak },
                content: {
                    // Number first: a tray notification is read at a glance, and
                    // the streak length IS the reason to care.
                    title: `${streak} วันติด — อย่าให้ขาด · ${streak}-day streak`,
                    body: 'เช็คอินวันนี้เพื่อรักษาสตรีคและรับเหรียญ · Check in today to keep your streak and claim your coins.',
                },
            } as any,
        });
        return true;
    } catch (error) {
        console.error(`[Courier] streak nudge to ${userId} failed:`, error);
        return false;
    }
}

export interface WeeklyDigest {
    /** Active listings on cards this user has wishlisted. */
    wishlistMatches: number;
    /** Cheapest wishlist match, for the headline. */
    topMatchName?: string;
    topMatchPrice?: number;
    /** Biggest 7-day mover in the user's vault. */
    moverName?: string;
    moverPercent?: number;
}

/**
 * Weekly digest: wishlist matches + the week's biggest price move in the vault.
 *
 * PUSH FIRST — a push when the user has a token, email only for the accounts
 * that cannot receive one. Two reasons. The obvious one is cost and inbox
 * fatigue. The load-bearing one is that this app's email is transactional
 * (orders, shipping, payouts) and a weekly marketing send from the same domain
 * is how that reputation gets spent; push has no shared reputation to lose.
 *
 * Never sends an empty digest — the caller is responsible for skipping users
 * with nothing to report, and this asserts it, because "0 new matches this
 * week" is exactly the notification that teaches people to disable them.
 */
export async function sendWeeklyDigestNotification(
    userId: string,
    digest: WeeklyDigest,
): Promise<'push' | 'email' | false> {
    const courier = getCourier();
    if (!courier) return false;
    if (digest.wishlistMatches <= 0 && digest.moverPercent === undefined) return false;

    const { email, fcmToken, prefs } = await getUserNotifContext(userId);
    const wantPush = !!fcmToken && prefs.digest_push !== false;
    const wantEmail = !wantPush && !!email && prefs.digest_email !== false;
    if (!wantPush && !wantEmail) return false;

    const matchLineTh = digest.wishlistMatches > 0
        ? `มีการ์ดใน Wishlist ${digest.wishlistMatches} ใบวางขายอยู่`
        : '';
    const matchLineEn = digest.wishlistMatches > 0
        ? `${digest.wishlistMatches} card${digest.wishlistMatches === 1 ? '' : 's'} from your wishlist ${digest.wishlistMatches === 1 ? 'is' : 'are'} listed`
        : '';
    const moverLineTh = digest.moverName && digest.moverPercent !== undefined
        ? `${digest.moverName} ${digest.moverPercent > 0 ? '+' : ''}${digest.moverPercent}% สัปดาห์นี้`
        : '';
    const moverLineEn = digest.moverName && digest.moverPercent !== undefined
        ? `${digest.moverName} moved ${digest.moverPercent > 0 ? '+' : ''}${digest.moverPercent}% this week`
        : '';

    const title = digest.wishlistMatches > 0
        ? `${matchLineTh || matchLineEn} · CardStreet`
        : `${moverLineTh || moverLineEn} · CardStreet`;
    const body = [matchLineEn, moverLineEn].filter(Boolean).join(' · ')
        || 'Your weekly CardStreet summary.';

    try {
        if (wantPush) {
            await courier.send.message({
                message: {
                    to: { ...buildRecipient(null, fcmToken), user_id: userId },
                    routing: buildRouting(false, true, 'inline'),
                    data: { type: 'weekly_digest', wishlistMatches: digest.wishlistMatches },
                    content: { title, body },
                } as any,
            });
            return 'push';
        }

        await courier.send.message({
            message: {
                to: { ...buildRecipient(email, null), user_id: userId },
                routing: buildRouting(true, false, 'inline'),
                // Thai in the subject needs the Postmark override: Courier's own
                // subject encoder truncates non-ASCII at 48 bytes (see SUBJECTS).
                providers: postmarkOverride(title),
                content: emailPlusPushContent({
                    title,
                    emailParagraphs: [
                        ...(matchLineEn ? [{ text: `${matchLineTh} · ${matchLineEn}.` }] : []),
                        ...(moverLineEn ? [{ text: `${moverLineTh} · ${moverLineEn}.` }] : []),
                        ...(digest.topMatchName && digest.topMatchPrice !== undefined
                            ? [{ text: `เช่น ${digest.topMatchName} — ฿${digest.topMatchPrice.toLocaleString('en-US')} · e.g. ${digest.topMatchName} at ฿${digest.topMatchPrice.toLocaleString('en-US')}.`, muted: true }]
                            : []),
                    ],
                    cta: {
                        label: 'เปิด CardStreet · Open CardStreet',
                        url: `${appBaseUrl()}/?tab=vault&utm_source=courier&utm_medium=email&utm_campaign=weekly_digest`,
                    },
                    pushBody: body,
                }),
            } as any,
        });
        return 'email';
    } catch (error) {
        console.error(`[Courier] weekly digest to ${userId} failed:`, error);
        return false;
    }
}

/**
 * "Someone wants a card in your vault." PUSH FIRST, email only without a token.
 *
 * The wishlist table has been collecting demand since launch and no seller
 * could see any of it. This is the seller-side counterpart of the buyer digest:
 * the buyer gets told when a wanted card is listed, the seller gets told when a
 * card they already own is wanted.
 *
 * Deliberately names ONE card rather than summarising. A count ("3 cards in
 * your vault are wanted") is a statistic; a name is an action.
 */
export async function sendVaultDemandNotification(
    userId: string,
    top: { cardName: string; wishlisters: number; suggestedPrice: number; othersCount: number },
): Promise<'push' | 'email' | false> {
    const courier = getCourier();
    if (!courier) return false;

    const { email, fcmToken, prefs } = await getUserNotifContext(userId);
    const wantPush = !!fcmToken && prefs.demand_push !== false;
    const wantEmail = !wantPush && !!email && prefs.demand_email !== false;
    if (!wantPush && !wantEmail) return false;

    const priceLabel = `฿${top.suggestedPrice.toLocaleString('en-US')}`;
    const title = `${top.wishlisters} คนตามหา ${top.cardName} · ${top.wishlisters} ${top.wishlisters === 1 ? 'person wants' : 'people want'} ${top.cardName}`;
    const more = top.othersCount > 0
        ? ` (+${top.othersCount} more in your vault)`
        : '';
    const body = `คุณมีใบนี้อยู่ในคลัง ลงขายราว ${priceLabel} · You have one in your vault — list it for about ${priceLabel}${more}.`;

    try {
        if (wantPush) {
            await courier.send.message({
                message: {
                    to: { ...buildRecipient(null, fcmToken), user_id: userId },
                    routing: buildRouting(false, true, 'inline'),
                    data: { type: 'vault_demand', wishlisters: top.wishlisters },
                    content: { title, body },
                } as any,
            });
            return 'push';
        }
        await courier.send.message({
            message: {
                to: { ...buildRecipient(email, null), user_id: userId },
                routing: buildRouting(true, false, 'inline'),
                providers: postmarkOverride(title),
                content: emailPlusPushContent({
                    title,
                    emailParagraphs: [{ text: body }],
                    cta: {
                        label: 'ลงขายเลย · List it',
                        url: `${appBaseUrl()}/?tab=vault&utm_source=courier&utm_medium=email&utm_campaign=vault_demand`,
                    },
                    pushBody: body,
                }),
            } as any,
        });
        return 'email';
    } catch (error) {
        console.error(`[Courier] vault demand to ${userId} failed:`, error);
        return false;
    }
}

/**
 * "This listing has sat for a month above market — reprice to ฿X?"
 *
 * The tap target is the listing, not a generic screen: a nudge that drops
 * someone on their listings page and leaves them to find the right row is the
 * same nudge that produced 667 stream pushes landing on the homepage.
 */
export async function sendStaleListingNudge(
    sellerId: string,
    listing: { listingId: string; cardId: string; cardName: string; currentPrice: number; suggestedPrice: number; ageDays: number },
): Promise<'push' | 'email' | false> {
    const courier = getCourier();
    if (!courier) return false;

    const { email, fcmToken, prefs } = await getUserNotifContext(sellerId);
    const wantPush = !!fcmToken && prefs.stale_listing_push !== false;
    const wantEmail = !wantPush && !!email && prefs.stale_listing_email !== false;
    if (!wantPush && !wantEmail) return false;

    const from = `฿${listing.currentPrice.toLocaleString('en-US')}`;
    const to = `฿${listing.suggestedPrice.toLocaleString('en-US')}`;
    const title = `${listing.cardName} — ${listing.ageDays} วันยังไม่ขาย · unsold for ${listing.ageDays} days`;
    const body = `ราคาสูงกว่าตลาด ลองปรับจาก ${from} เป็น ${to} · Priced above market. Try ${from} → ${to}.`;

    try {
        if (wantPush) {
            await courier.send.message({
                message: {
                    to: { ...buildRecipient(null, fcmToken), user_id: sellerId },
                    routing: buildRouting(false, true, 'inline'),
                    data: {
                        type: 'stale_listing',
                        listingId: listing.listingId,
                        cardId: listing.cardId,
                        suggestedPrice: listing.suggestedPrice,
                    },
                    content: { title, body },
                } as any,
            });
            return 'push';
        }
        await courier.send.message({
            message: {
                to: { ...buildRecipient(email, null), user_id: sellerId },
                routing: buildRouting(true, false, 'inline'),
                providers: postmarkOverride(title),
                content: emailPlusPushContent({
                    title,
                    emailParagraphs: [{ text: body }],
                    cta: {
                        label: 'แก้ราคา · Update the price',
                        // cardId for the same reason as the push tap handler:
                        // the vault's price editor is keyed on the collection
                        // item, which knows its card but not its listing.
                        url: `${appBaseUrl()}/?tab=vault&reprice=${encodeURIComponent(listing.cardId)}&utm_source=courier&utm_medium=email&utm_campaign=stale_listing`,
                    },
                    pushBody: body,
                }),
            } as any,
        });
        return 'email';
    } catch (error) {
        console.error(`[Courier] stale listing nudge to ${sellerId} failed:`, error);
        return false;
    }
}

export async function sendBreakerApplicationAlert(application: {
    id: string;
    fullName: string;
    email: string;
    phone: string;
    city: string;
    province: string;
    businessName?: string | null;
    applicantTypes: string[];
    games: string[];
    breakingExperience: string;
    availability: string;
    locale: string;
    hasAccount: boolean;
    utm?: Record<string, string> | null;
}): Promise<void> {
    const courier = getCourier();
    if (!courier) { console.warn('[Courier] Client not initialized — skipping breaker-application alert'); return; }

    const to = (process.env.BREAKER_APPLICATION_NOTIFY_EMAIL || 'brandonlcole35@gmail.com').trim();
    if (!to) return;

    const submittedAt = new Date().toLocaleString('en-US', {
        timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short',
    });
    const campaign = application.utm && Object.keys(application.utm).length
        ? Object.entries(application.utm).map(([k, v]) => `${k}=${v}`).join(', ')
        : 'direct';

    // Reuse the console's English labels rather than printing raw option ids —
    // "Card shop / 1–3 years / Needs minor work" instead of
    // "card_shop / 1_to_3y / minor_improvements".
    const labelled = (map: Record<string, string>, ids: string[]) =>
        ids.map((id) => map[id] ?? id).join(', ') || '—';

    const lines = [
        `Name: ${application.fullName}`,
        application.businessName ? `Shop/channel: ${application.businessName}` : null,
        `Email: ${application.email}`,
        `Phone: ${application.phone}`,
        `Location: ${application.city}, ${application.province}`,
        `Applicant type: ${labelled(ADMIN_LABELS.applicantType, application.applicantTypes)}`,
        `Games: ${labelled(ADMIN_LABELS.game, application.games)}`,
        `Breaking experience: ${ADMIN_LABELS.experience[application.breakingExperience as keyof typeof ADMIN_LABELS.experience] ?? application.breakingExperience}`,
        `Availability: ${application.availability}`,
        `Applied in: ${application.locale === 'th' ? 'Thai' : 'English'}`,
        `CardStreet account: ${application.hasAccount ? 'yes (linked)' : 'not signed in'}`,
        `Campaign: ${campaign}`,
        `Submitted: ${submittedAt} (Bangkok)`,
        '',
        `Review: ${appBaseUrl()}/admin/breakers`,
    ].filter((l) => l !== null) as string[];

    try {
        const sendResult = await courier.send.message({
            message: {
                to: { email: to },
                content: {
                    title: `New breaker application: ${application.fullName}`,
                    body: `Someone applied to host on Cardstreet Live.\n\n${lines.join('\n')}`,
                },
                routing: { method: 'all', channels: ['email'] },
                data: { type: 'breaker_application', applicationId: application.id },
            },
        });
        console.log(
            `[Courier] ✅ 'Breaker Application' alert sent for ${application.email} → ${to}. ` +
            `Request ID: ${(sendResult as { requestId?: string })?.requestId ?? 'n/a'}`,
        );
    } catch (error) {
        console.error(`[Courier] ❌ Error sending 'Breaker Application' alert for ${application.email}:`, error);
    }
}

// ─── Applicant receipt: breaker application confirmation ─────────────────────

/**
 * Confirms to the applicant that their /become-a-breaker application arrived.
 *
 * Customer-facing, so unlike sendBreakerApplicationAlert above this is written
 * to be read by the applicant — bilingual, and with the Thai-first subject
 * forced through Postmark because Courier truncates non-ASCII subjects at the
 * 48-byte encoded-word cliff (see SUBJECTS). It uses inline `content` rather
 * than a dashboard template for the same reason sendWishlistListingAlert and
 * the Stripe nudge do: no template exists yet, and the funnel shouldn't wait on
 * dashboard work. Set COURIER_BREAKER_CONFIRMATION_TEMPLATE_ID to switch — the
 * `data` block below already carries the merge fields a template would read.
 *
 * Most applicants have no CardStreet account, so this addresses a raw email
 * rather than a userId: no notification_preferences row to consult and no push
 * channel. That also means there is no unsubscribe state to honour — which is
 * fine for a transactional receipt of an action they just took, and is the
 * reason this must never become a marketing send.
 *
 * Language order follows what they told us: `preferredLanguage` ('th' | 'en')
 * when they picked one, otherwise the locale they filled the form in. Both
 * languages are always included, so a mis-set preference never leaves someone
 * with an email they cannot read.
 *
 * Says nothing about when they will hear back — the landing page, the Breaker
 * Program Terms, and the success screen all decline to promise a review
 * timeline, and a receipt that invents one would contradict them.
 *
 * Best-effort, never throws: the application is already committed when this
 * runs, so a Courier failure costs a courtesy email, not the lead.
 */
export async function sendBreakerApplicationConfirmation(applicant: {
    email: string;
    fullName: string;
    preferredLanguage: string;
    locale: string;
}): Promise<boolean> {
    const courier = getCourier();
    if (!courier) { console.warn('[Courier] Client not initialized — skipping breaker confirmation'); return false; }

    const to = applicant.email.trim();
    if (!to) return false;

    const supportEmail = (process.env.CARDSTREET_SUPPORT_EMAIL || 'support@thailandtcg.com').trim();
    // First name only: "Somchai Tanaka" -> "Somchai". Falls back to no greeting
    // name rather than printing an empty string.
    const firstName = applicant.fullName.trim().split(/\s+/)[0] || '';
    const thaiFirst = applicant.preferredLanguage === 'th'
        || (applicant.preferredLanguage !== 'en' && applicant.locale === 'th');

    const th = [
        firstName ? `สวัสดีคุณ ${firstName}` : 'สวัสดีครับ',
        '',
        'เราได้รับใบสมัคร Cardstreet Breaker ของคุณเรียบร้อยแล้ว ขอบคุณที่สนใจมาเป็นส่วนหนึ่งของ Cardstreet Live',
        'ทีมงานจะตรวจสอบข้อมูลของคุณ และจะติดต่อกลับหากคุณได้รับเลือกให้เข้าสู่ขั้นตอนถัดไป',
        'การสมัครไม่ได้รับประกันว่าจะได้รับการอนุมัติ และคุณไม่ต้องดำเนินการใด ๆ เพิ่มเติมในตอนนี้',
        '',
        `หากต้องการแก้ไขข้อมูลหรือมีคำถาม ตอบกลับอีเมลนี้ หรือติดต่อ ${supportEmail}`,
        `ข้อกำหนดโปรแกรม Breaker: ${appBaseUrl()}/breaker-terms`,
    ].join('\n');

    const en = [
        firstName ? `Hi ${firstName},` : 'Hi,',
        '',
        'We have received your Cardstreet Breaker application. Thank you for your interest in Cardstreet Live.',
        'Our team will review your information and contact you if you are selected for the next step.',
        'Applying does not guarantee approval, and there is nothing further you need to do right now.',
        '',
        `If you need to correct anything or have a question, reply to this email or contact ${supportEmail}.`,
        `Breaker Program Terms: ${appBaseUrl()}/breaker-terms`,
    ].join('\n');

    // Thai first in the subject regardless of preference, matching the house
    // style in SUBJECTS — the body order is what follows the applicant.
    const title = 'ได้รับใบสมัครแล้ว — Application received';
    const body = thaiFirst ? `${th}\n\n———\n\n${en}` : `${en}\n\n———\n\n${th}`;

    const templateId = (process.env.COURIER_BREAKER_CONFIRMATION_TEMPLATE_ID || '').trim();
    const message: Record<string, unknown> = {
        to: { email: to },
        routing: { method: 'all', channels: ['email'] },
        data: {
            type: 'breaker_application_confirmation',
            firstName,
            supportEmail,
            termsUrl: `${appBaseUrl()}/breaker-terms`,
            preferredLanguage: applicant.preferredLanguage,
        },
        providers: postmarkOverride(title),
    };
    if (templateId) message.template = templateId;
    else message.content = { title, body };

    try {
        const sendResult = await courier.send.message({ message: message as any });
        console.log(
            `[Courier] ✅ Breaker application confirmation sent to ${to}. ` +
            `Request ID: ${(sendResult as { requestId?: string })?.requestId ?? 'n/a'}`,
        );
        return true;
    } catch (error) {
        console.error(`[Courier] ❌ Error sending breaker confirmation to ${to}:`, error);
        return false;
    }
}
