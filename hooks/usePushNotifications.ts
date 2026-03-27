import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications, Token, ActionPerformed, PushNotificationSchema } from '@capacitor/push-notifications';

export const usePushNotifications = () => {
    const [fcmToken, setFcmToken] = useState<string | null>(null);

    useEffect(() => {
        // Only run on native platforms (Android/iOS)
        if (!Capacitor.isNativePlatform()) return;

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

        // Add listeners
        PushNotifications.addListener('registration', async (token: Token) => {
            console.log('Push registration success, token:', token.value);
            setFcmToken(token.value);
            
            // Send token to backend
            try {
                const response = await fetch('/api/users/fcm', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fcmToken: token.value })
                });
                if (!response.ok) {
                    console.error('Failed to save FCM token to backend');
                }
            } catch (err) {
                console.error('Error saving FCM token:', err);
            }
        });

        PushNotifications.addListener('registrationError', (error: any) => {
            console.error('Error on push registration:', error);
        });

        PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
            console.log('Push received in foreground:', notification);
        });

        PushNotifications.addListener('pushNotificationActionPerformed', (notification: ActionPerformed) => {
            console.log('Push action performed:', notification);
        });

        // Request registration
        registerPushNotifications();

        // Cleanup listeners on unmount
        return () => {
            PushNotifications.removeAllListeners();
        };
    }, []);

    return { fcmToken };
};
