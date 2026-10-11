import { useEffect, useState } from 'react';
import * as Sentry from '@sentry/nextjs';
import { Capacitor } from '@capacitor/core';
import { PushNotifications, Token, ActionPerformed, PushNotificationSchema } from '@capacitor/push-notifications';

// Route a notification tap by the Courier `data.type` payload. Offer pushes
// land in the Offers panel — the same destination as the offer-email CTA
// (/?view=offers). When the mobile shell is mounted it consumes the event and
// switches tabs in place (no reload); otherwise (cold start from a killed app,
// or the webview sitting on a non-SPA page) fall back to a full navigation,
// which MobileHome's /?view=offers landing branch handles on mount.
function routeNotificationTap(data: unknown) {
    const type = (data as { type?: unknown } | null | undefined)?.type;
    if (typeof type !== 'string') return;
    // Stream pushes deep-link to the show. This branch did not exist for
    // the first two shows, so every accepted stream push (~667 across
    // 08-18 + 08-22) opened the app to the HOMEPAGE on tap — push
    // contributed zero measured arrivals while looking fully delivered.
    // showUrl carries the send's UTM tags, so using it (host-checked)
    // keeps push arrivals attributable in GA; streamId is the fallback.
    if (type === 'stream_live' || type === 'stream_announce' || type === 'stream_starting_soon') {
        const d = data as { showUrl?: unknown; streamId?: unknown };
        const showUrl = typeof d?.showUrl === 'string' ? d.showUrl : '';
        if (showUrl.startsWith('https://cardstreet.app/')) {
            window.location.assign(showUrl);
        } else if (typeof d?.streamId === 'string' && /^[0-9a-f-]{36}$/.test(d.streamId)) {
            window.location.assign(`/live/${d.streamId}?utm_source=courier&utm_medium=push&utm_campaign=live_golive`);
        }
        return;
    }
    // Retention pushes. Both are inert without a destination: a nudge that
    // opens the homepage is the same bug the stream branch above was added to
    // fix (~667 pushes that all landed nowhere).
    // rewards_launch = the one-off Rewards launch blast (2026-09-22);
    // same destination as the streak nudge, the hub itself.
    if (type === 'streak_at_risk' || type === 'rewards_launch') {
        // The Rewards Hub is a shell overlay, not a route — ask the mounted
        // shell to open it, and only hard-navigate if nothing consumed the
        // event (cold start from a killed app, or a non-SPA page).
        const unconsumed = window.dispatchEvent(new CustomEvent('cs:openRewards', { cancelable: true }));
        if (unconsumed) window.location.assign('/?tab=profile&openRewards=1');
        return;
    }
    if (type === 'vault_demand') {
        // The wanted card is in their vault, so that is where the tap lands.
        window.location.assign('/?tab=vault&utm_source=courier&utm_medium=push&utm_campaign=vault_demand');
        return;
    }
    if (type === 'stale_listing') {
        // cardId, not listingId: the vault's price editor is keyed on the
        // COLLECTION ITEM, and collection_items carries a card_id but no
        // listing_id — so the card is the only identifier both ends share.
        const d = data as { cardId?: unknown };
        const id = typeof d?.cardId === 'string' ? d.cardId : '';
        window.location.assign(
            `/?tab=vault${id ? `&reprice=${encodeURIComponent(id)}` : ''}&utm_source=courier&utm_medium=push&utm_campaign=stale_listing`,
        );
        return;
    }
    if (type === 'shipping_launch') {
        // The Oct 9 shipping-in-price reminders go to sellers, whose prices
        // and listings are in the Vault (lib/launchCampaign.ts).
        window.location.assign('/?tab=vault&utm_source=courier&utm_medium=push&utm_campaign=shipping_launch');
        return;
    }
    if (type === 'weekly_digest') {
        // Both halves of the digest — wishlist matches and vault price moves —
        // are read from the Vault tab.
        window.location.assign('/?tab=vault&utm_source=courier&utm_medium=push&utm_campaign=weekly_digest');
        return;
    }
    // Order pushes (seller: sold, label ready, ship reminders; buyer: shipped,
    // confirmed, delivered, payout) all carry the orderId. Land on that order
    // inside Profile — Pending Shipments with the Print Shipping Label button
    // for the seller, Track Orders for the buyer; Profile resolves the side.
    // Before this branch every one of these taps opened the app to home.
    if (
        type === 'sold' || type === 'label_generated' || type === 'ship_reminder' || type === 'unshipped_order' ||
        type === 'shipped' || type === 'order_confirmation' || type === 'purchase_completed' ||
        type === 'package_delivered' || type === 'payout_completed'
    ) {
        const d = data as { orderId?: unknown };
        const orderId = typeof d?.orderId === 'string' && /^[0-9a-f-]{36}$/i.test(d.orderId) ? d.orderId : '';
        if (!orderId) return;
        try { sessionStorage.setItem('cs_focus_order', orderId); } catch { /* landing fallback still opens Profile */ }
        const unconsumed = window.dispatchEvent(new CustomEvent('cs-open-order', { detail: orderId, cancelable: true }));
        if (unconsumed) window.location.assign(`/?order=${encodeURIComponent(orderId)}`);
        return;
    }
    if (type === 'support_reply') {
        // The answer lives in Profile -> Support. Same handoff as offers below:
        // flag + event for a mounted shell, hard navigation on a cold start.
        try { sessionStorage.setItem('cs_open_support', '1'); } catch { /* landing fallback still opens Profile */ }
        const unconsumed = window.dispatchEvent(new CustomEvent('cs-open-support', { cancelable: true }));
        if (unconsumed) window.location.assign('/?tab=support');
        return;
    }
    if (!type.startsWith('offer_')) return;
    // An ACCEPTED offer has exactly one next step, so its tap goes straight to
    // payment rather than to the Offers list. Every other offer push (received,
    // countered, rejected, expired) needs the list, where the user chooses.
    if (type === 'offer_accepted') {
        const d = data as { offerId?: unknown };
        const offerId = typeof d?.offerId === 'string' ? d.offerId : '';
        if (offerId) {
            window.location.assign(`/pay/${encodeURIComponent(offerId)}`);
            return;
        }
    }
    try { sessionStorage.setItem('cs_open_offers', '1'); } catch { /* landing fallback still opens Profile */ }
    const unconsumed = window.dispatchEvent(new CustomEvent('cs-open-offers', { cancelable: true }));
    if (unconsumed) window.location.assign('/?view=offers');
}

// Persist the device token under the user. The backend column is FCM-based, so the
// value sent here must be an FCM token on BOTH platforms (see iOS note below).
async function saveToken(token: string) {
    try {
        const response = await fetch('/api/users/fcm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fcmToken: token })
        });
        if (!response.ok) {
            console.error('Failed to save FCM token to backend');
        }
    } catch (err) {
        console.error('Error saving FCM token:', err);
    }
}

// The permission-denied warning exists to COUNT devices with push turned off,
// and one report per device does that. Sent on every app launch it was ~440
// events a fortnight from the same phones (CARDSTREET-3G/3J). Re-reports when
// the state changes (e.g. 'denied' -> 'prompt'), so a fresh denial still shows.
function reportPushDeniedOnce(platform: 'ios' | 'android', receive: string) {
    const key = `cs_push_denied_reported_${platform}`;
    try {
        if (localStorage.getItem(key) === receive) return;
        localStorage.setItem(key, receive);
    } catch { /* storage blocked: report every time, as before */ }
    Sentry.captureMessage(`${platform === 'ios' ? 'iOS' : 'Android'} push permission not granted`, {
        level: 'warning',
        tags: { area: 'push', platform },
        extra: { receive },
    });
}

// Clears the once-per-device marker so a later denial is reported again.
function clearPushDeniedMarker(platform: 'ios' | 'android') {
    try { localStorage.removeItem(`cs_push_denied_reported_${platform}`); } catch { /* nothing to clear */ }
}

export const usePushNotifications = () => {
    const [fcmToken, setFcmToken] = useState<string | null>(null);

    useEffect(() => {
        // Only run on native platforms (Android/iOS)
        if (!Capacitor.isNativePlatform()) return;

        let cleanup = () => {};

        if (Capacitor.getPlatform() === 'ios') {
            // On iOS, @capacitor/push-notifications surfaces the raw APNs token, which our
            // FCM-based backend cannot address. Firebase Messaging registers with APNs under
            // the hood and hands back a real FCM token, keeping the backend identical to
            // Android. Imported dynamically so the firebase JS dependency is code-split and
            // never loaded on web or Android.
            (async () => {
              try {
                const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');

                let perm = await FirebaseMessaging.checkPermissions();
                if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
                    perm = await FirebaseMessaging.requestPermissions();
                }
                if (perm.receive !== 'granted') {
                    console.warn('User denied push notification permissions');
                    // Reported, not just logged: this path yields no token AND
                    // no trace, which looks identical to the plugin failing.
                    // 30 days after the getToken() instrumentation went live
                    // there were ZERO area:push events despite ~1.6k iOS
                    // installs (measured 2026-08-18) — every remaining
                    // explanation for that silence exits through here or the
                    // catch below, so both now report.
                    reportPushDeniedOnce('ios', perm.receive);
                    return;
                }
                clearPushDeniedMarker('ios');

                const tokenReceived = await FirebaseMessaging.addListener('tokenReceived', (event) => {
                    setFcmToken(event.token);
                    saveToken(event.token);
                });
                const notificationReceived = await FirebaseMessaging.addListener('notificationReceived', () => {
                    console.log('Push received in foreground');
                });
                const notificationActionPerformed = await FirebaseMessaging.addListener('notificationActionPerformed', (event) => {
                    console.log('Push action performed');
                    routeNotificationTap(event.notification?.data);
                });

                // APNs delivery RACES this call. After the permission grant
                // the plugin registers with APNs, Apple's roundtrip takes
                // ~0.1-3s, and until the device token lands the plugin
                // rejects getToken with "No APNS token specified before
                // fetching FCM Token" — field-confirmed the day this
                // instrumentation shipped (CARDSTREET-3H: iPhone, iOS 18.7,
                // granted permission, lost the race, got no token). One eager
                // call was all we made, so the race WAS the iOS token
                // pipeline. Retry with backoff (~20s total) before concluding
                // anything is broken; tokenReceived above stays as the net
                // for a token that arrives after we stop asking. If all
                // attempts fail, the LAST error still names the cause — and
                // "No APNS token" surviving 6 attempts would mean APNs
                // delivery itself is broken (swizzling/entitlement), not the
                // race.
                let lastErr: unknown = null;
                for (let attempt = 1; attempt <= 6; attempt++) {
                    try {
                        const { token } = await FirebaseMessaging.getToken();
                        if (token) {
                            setFcmToken(token);
                            saveToken(token);
                            lastErr = null;
                            break;
                        }
                        lastErr = new Error('iOS FCM token empty');
                    } catch (err) {
                        lastErr = err;
                    }
                    await new Promise((r) => setTimeout(r, 1200 * attempt));
                }
                if (lastErr) {
                    console.error('Error fetching FCM token:', lastErr);
                    Sentry.captureException(lastErr, {
                        tags: { area: 'push', platform: 'ios' },
                        extra: { stage: 'FirebaseMessaging.getToken', attempts: 6 },
                    });
                }

                cleanup = () => {
                    tokenReceived.remove();
                    notificationReceived.remove();
                    notificationActionPerformed.remove();
                };
              } catch (err) {
                // Everything before getToken()'s own catch — above all the
                // Capacitor bridge throwing '"FirebaseMessaging" plugin is not
                // implemented on ios', which is what a binary built without the
                // plugin looks like from JS. That previously escaped as an
                // untagged unhandled rejection (the Android twin of exactly
                // this error is already in Sentry), so it never showed up under
                // area:push and the iOS path read as silent rather than broken.
                Sentry.captureException(err, {
                    tags: { area: 'push', platform: 'ios' },
                    extra: { stage: 'ios push init' },
                });
              }
            })();

            return () => cleanup();
        }

        // Android: @capacitor/push-notifications already returns an FCM token directly.
        const registerPushNotifications = async () => {
            try {
                let permStatus = await PushNotifications.checkPermissions();

                if (permStatus.receive === 'prompt') {
                    permStatus = await PushNotifications.requestPermissions();
                }

                if (permStatus.receive !== 'granted') {
                    console.warn('User denied push notification permissions');
                    reportPushDeniedOnce('android', permStatus.receive);
                    return;
                }
                clearPushDeniedMarker('android');

                await PushNotifications.register();
            } catch (err) {
                // Already observed in production as an UNTAGGED unhandled
                // rejection ('"PushNotifications" plugin is not implemented on
                // android', 5 events across 5 users) — devices running a shell
                // built without the plugin. Tagging it puts those devices under
                // the same area:push query as everything else.
                Sentry.captureException(err, {
                    tags: { area: 'push', platform: 'android' },
                    extra: { stage: 'android push register' },
                });
            }
        };

        PushNotifications.addListener('registration', async (token: Token) => {
            // Do not log the raw token — it grants the holder the ability to
            // address push notifications to this device.
            console.log('Push registration success');
            setFcmToken(token.value);
            saveToken(token.value);
        });

        PushNotifications.addListener('registrationError', (error: any) => {
            console.error('Error on push registration:', error);
            // Same blindness the iOS path suffered from: a device that never
            // registers is indistinguishable from one that never opened the
            // app unless the failure is reported somewhere we read.
            // The plugin hands back a plain { error: string } object, which
            // Sentry could only title "Object captured as exception with keys:
            // error" (CARDSTREET-3K). Wrap it so the native message is the title.
            const detail = typeof error?.error === 'string' ? error.error
                : typeof error?.message === 'string' ? error.message
                : JSON.stringify(error);
            Sentry.captureException(new Error(`Android push registration failed: ${detail}`), {
                // SERVICE_NOT_AVAILABLE is the phone failing to reach Google
                // Play services (no connectivity or no Play services); the next
                // launch registers again.
                level: /SERVICE_NOT_AVAILABLE/.test(detail) ? 'warning' : 'error',
                tags: { area: 'push', platform: 'android' },
                extra: { stage: 'PushNotifications.register', raw: error },
            });
        });

        PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
            console.log('Push received in foreground:', notification);
        });

        PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
            console.log('Push action performed:', action);
            routeNotificationTap(action.notification?.data);
        });

        registerPushNotifications();

        cleanup = () => {
            PushNotifications.removeAllListeners();
        };

        // Cleanup listeners on unmount
        return () => cleanup();
    }, []);

    return { fcmToken };
};
