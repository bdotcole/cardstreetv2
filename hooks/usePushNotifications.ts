import { useEffect, useState } from 'react';
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
                const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');

                let perm = await FirebaseMessaging.checkPermissions();
                if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
                    perm = await FirebaseMessaging.requestPermissions();
                }
                if (perm.receive !== 'granted') {
                    console.warn('User denied push notification permissions');
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

                try {
                    const { token } = await FirebaseMessaging.getToken();
                    if (token) {
                        setFcmToken(token);
                        saveToken(token);
                    }
                } catch (err) {
                    console.error('Error fetching FCM token:', err);
                }

                cleanup = () => {
                    tokenReceived.remove();
                    notificationReceived.remove();
                    notificationActionPerformed.remove();
                };
            })();

            return () => cleanup();
        }

        // Android: @capacitor/push-notifications already returns an FCM token directly.
        const registerPushNotifications = async () => {
            let permStatus = await PushNotifications.checkPermissions();

            if (permStatus.receive === 'prompt') {
                permStatus = await PushNotifications.requestPermissions();
            }

            if (permStatus.receive !== 'granted') {
                console.warn('User denied push notification permissions');
                return;
            }

            await PushNotifications.register();
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
