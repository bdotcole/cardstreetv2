'use client';

import { usePushNotifications } from '@/hooks/usePushNotifications';

export default function PushNotificationManager() {
    usePushNotifications();
    return null;
}
