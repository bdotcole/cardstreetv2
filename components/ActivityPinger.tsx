'use client';

import { useEffect } from 'react';

/**
 * Records that a signed-in user opened the app, into profiles.last_active_at.
 *
 * Mounted globally next to PushNotificationManager, but unlike that one this
 * must run on EVERY platform — the native shell loads this same web app, so a
 * single ping covers web and native and they stay directly comparable.
 *
 * Throttled to once an hour per browser via localStorage, which is what keeps
 * this from becoming a write on every navigation: DAU/WAU only need to know
 * the user showed up today, not how many pages they viewed. A user in a
 * private window or with storage blocked simply pings once per page load,
 * which is still bounded and harmless.
 */
const PING_INTERVAL_MS = 60 * 60 * 1000;
const STORAGE_KEY = 'cs_last_ping';

export default function ActivityPinger() {
    useEffect(() => {
        let cancelled = false;

        const ping = () => {
            let last = 0;
            try {
                last = Number(localStorage.getItem(STORAGE_KEY) || 0);
            } catch {
                // Storage blocked — fall through and ping.
            }
            if (Date.now() - last < PING_INTERVAL_MS) return;
            try {
                localStorage.setItem(STORAGE_KEY, String(Date.now()));
            } catch {
                // Non-fatal.
            }
            // keepalive so a ping fired as the tab closes still lands.
            void fetch('/api/users/ping', { method: 'POST', keepalive: true }).catch(() => {});
        };

        // Defer past first paint: this is telemetry and must never compete
        // with rendering the page the user actually came for.
        const timer = setTimeout(() => { if (!cancelled) ping(); }, 2000);

        // A returning tab (phone unlocked, app foregrounded) is a fresh
        // session for our purposes; the hourly throttle still applies.
        const onVisible = () => { if (document.visibilityState === 'visible') ping(); };
        document.addEventListener('visibilitychange', onVisible);

        return () => {
            cancelled = true;
            clearTimeout(timer);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, []);

    return null;
}
