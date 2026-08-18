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
    if (typeof type !== 'string' || !type.startsWith('offer_')) return;
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
                    Sentry.captureMessage('iOS push permission not granted', {
                        level: 'warning',
                        tags: { area: 'push', platform: 'ios' },
                        extra: { receive: perm.receive },
                    });
                    return;
                }

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

                // Measured 2026-08-18: of 363 registered devices, ZERO were
                // iOS — no iPhone has ever reached saveToken. Every in-repo
                // requirement checks out (FirebaseApp.configure, matching
                // bundle id, aps-environment, swizzling on, getToken called
                // explicitly), so the failure is environmental: most likely a
                // missing APNs .p8 in Firebase, or a shipped binary predating
                // this code. console.error on a user's phone told us none of
                // that, which is why it went unnoticed for months — report it
                // where we can actually see it.
                try {
                    const { token } = await FirebaseMessaging.getToken();
                    if (token) {
                        setFcmToken(token);
                        saveToken(token);
                    } else {
                        Sentry.captureMessage('iOS FCM token empty', {
                            level: 'warning',
                            tags: { area: 'push', platform: 'ios' },
                        });
                    }
                } catch (err) {
                    console.error('Error fetching FCM token:', err);
                    // The Firebase error text names the cause (e.g. "No APNS
                    // token specified" / "APNS device token not set"), so the
                    // Sentry issue itself is the diagnosis.
                    Sentry.captureException(err, {
                        tags: { area: 'push', platform: 'ios' },
                        extra: { stage: 'FirebaseMessaging.getToken' },
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
                    Sentry.captureMessage('Android push permission not granted', {
                        level: 'warning',
                        tags: { area: 'push', platform: 'android' },
                        extra: { receive: permStatus.receive },
                    });
                    return;
                }

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
            Sentry.captureException(error, {
                tags: { area: 'push', platform: 'android' },
                extra: { stage: 'PushNotifications.register' },
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
