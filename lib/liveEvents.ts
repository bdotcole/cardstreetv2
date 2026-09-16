'use client';

/**
 * Live-show funnel events — the steps between a social viewer landing on
 * /live/[id] and a paid spot.
 *
 * Why a separate module from lib/engagementEvents.ts: the live funnel is the
 * one CardStreet will BUY traffic for (Facebook / TikTok live-stream ads
 * pointing at the website), and paid traffic is only tunable when the ad
 * platform can see the conversion. So every step here goes to GA4 AND the
 * Meta Pixel: `live_view` doubles as Meta's standard ViewContent and
 * `live_spot_purchase` as Purchase (with THB value), which is what lets a
 * Facebook campaign optimize for buyers instead of clicks.
 *
 * Both sinks are inert when their env var is unset (GA tag / Pixel not
 * loaded), and nothing here may ever break the action it measures.
 */

import { Capacitor } from '@capacitor/core';
import { sendGAEvent } from '@next/third-parties/google';
import { trackMetaEvent } from '@/lib/metaEvents';

export type LiveFunnelEvent =
    | 'live_view'
    | 'live_signin_prompt'
    | 'live_spot_claim'
    | 'live_spot_purchase';

function surface(): 'native_app' | 'web' {
    try {
        return Capacitor.isNativePlatform() ? 'native_app' : 'web';
    } catch {
        return 'web';
    }
}

export function trackLiveEvent(
    name: LiveFunnelEvent,
    params: { streamId: string; status?: string; valueThb?: number; numItems?: number } & Record<
        string,
        string | number | boolean | undefined
    >,
): void {
    if (typeof window === 'undefined') return;
    const { streamId, status, valueThb, numItems, ...rest } = params;
    try {
        sendGAEvent('event', name, {
            ...rest,
            stream_id: streamId,
            ...(status ? { stream_status: status } : {}),
            ...(typeof valueThb === 'number' ? { value: valueThb, currency: 'THB' } : {}),
            surface: surface(),
        });
    } catch {
        // GA not loaded.
    }
    try {
        if (name === 'live_view') {
            trackMetaEvent('ViewContent', { content_ids: [streamId], content_type: 'live_show' });
        } else if (name === 'live_spot_claim') {
            trackMetaEvent('AddToCart', { content_ids: [streamId], content_type: 'live_show' });
        } else if (name === 'live_spot_purchase' && typeof valueThb === 'number') {
            trackMetaEvent('Purchase', {
                value: valueThb,
                currency: 'THB',
                content_ids: [streamId],
                content_type: 'live_show',
                num_items: numItems,
            });
        }
    } catch {
        // Pixel not loaded.
    }
}
