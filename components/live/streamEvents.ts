'use client';

/**
 * One Realtime broadcast channel per stream — `stream-react:{streamId}` —
 * carrying every ephemeral room event. Server routes relay onto it via
 * httpSend (service key, REST); nothing here persists:
 *
 *   'sticker'     tap reactions            {sticker, from}
 *   'auction'     live-auction state push  {lotId, auction, at}
 *   'spot_focus'  breaker's "now opening"  {lotId, spotNumber, buyerName, ...}
 *
 * The viewer and the console both subscribe through this single hook so a
 * second event type never costs a second socket subscription. Handlers ride
 * refs — the channel binds once per (streamId, active) and never re-binds on
 * a render.
 *
 * Delivery is best-effort by design: auction state also lands via the detail
 * refetch paths, and spot_focus is mirrored into system chat, so a dropped
 * broadcast degrades to "slightly later", never "never".
 */

import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { isStickerKey, type StickerKey } from '@/components/live/stickers';
import type { LiveAuctionState } from '@/components/live/shared';

export interface SpotFocusEvent {
    lotId: string;
    spotNumber: number;
    buyerName: string | null;
    packs: number[] | null;
    entity: string | null;
    /** Server timestamp (ms) — stale-event ordering + banner expiry anchor. */
    at: number;
}

export interface SpotSoldEvent {
    lotId: string;
    spotNumber: number;
    buyerName: string | null;
    at: number;
}

export interface StreamEventHandlers {
    onSticker?: (sticker: StickerKey, from: string | null) => void;
    onAuction?: (lotId: string, auction: LiveAuctionState, at: number) => void;
    onSpotFocus?: (focus: SpotFocusEvent) => void;
    /** A spot purchase finalized — the room's celebration moment. */
    onSpotSold?: (sold: SpotSoldEvent) => void;
    /** A viewer joined (ephemeral; token route relays it, client dedupes). */
    onViewerJoined?: (name: string) => void;
}

function asAuctionState(value: unknown): LiveAuctionState | null {
    if (!value || typeof value !== 'object') return null;
    const a = value as Record<string, unknown>;
    if (typeof a.id !== 'string' || typeof a.status !== 'string') return null;
    if (typeof a.current_price !== 'number' || typeof a.ends_at !== 'string') return null;
    return value as LiveAuctionState;
}

export function useStreamEvents(
    streamId: string,
    active: boolean,
    handlers: StreamEventHandlers,
): void {
    const handlersRef = useRef(handlers);
    handlersRef.current = handlers;

    useEffect(() => {
        if (!active || !streamId) return;
        const supabase = createClient();
        const channel = supabase
            .channel(`stream-react:${streamId}`)
            .on('broadcast', { event: 'sticker' }, ({ payload }) => {
                const p = (payload ?? {}) as { sticker?: unknown; from?: unknown };
                if (isStickerKey(p.sticker)) {
                    handlersRef.current.onSticker?.(
                        p.sticker,
                        typeof p.from === 'string' && p.from.trim() ? p.from : null,
                    );
                }
            })
            .on('broadcast', { event: 'auction' }, ({ payload }) => {
                const p = (payload ?? {}) as { lotId?: unknown; auction?: unknown; at?: unknown };
                const auction = asAuctionState(p.auction);
                if (typeof p.lotId === 'string' && auction) {
                    handlersRef.current.onAuction?.(
                        p.lotId,
                        auction,
                        typeof p.at === 'number' ? p.at : Date.now(),
                    );
                }
            })
            .on('broadcast', { event: 'spot_focus' }, ({ payload }) => {
                const p = (payload ?? {}) as Partial<Record<keyof SpotFocusEvent, unknown>>;
                if (typeof p.lotId !== 'string' || typeof p.spotNumber !== 'number') return;
                handlersRef.current.onSpotFocus?.({
                    lotId: p.lotId,
                    spotNumber: p.spotNumber,
                    buyerName:
                        typeof p.buyerName === 'string' && p.buyerName.trim() ? p.buyerName : null,
                    packs: Array.isArray(p.packs)
                        ? p.packs.filter((n): n is number => typeof n === 'number')
                        : null,
                    entity: typeof p.entity === 'string' && p.entity.trim() ? p.entity : null,
                    at: typeof p.at === 'number' ? p.at : Date.now(),
                });
            })
            .on('broadcast', { event: 'spot_sold' }, ({ payload }) => {
                const p = (payload ?? {}) as Partial<Record<keyof SpotSoldEvent, unknown>>;
                if (typeof p.lotId !== 'string' || typeof p.spotNumber !== 'number') return;
                handlersRef.current.onSpotSold?.({
                    lotId: p.lotId,
                    spotNumber: p.spotNumber,
                    buyerName:
                        typeof p.buyerName === 'string' && p.buyerName.trim() ? p.buyerName : null,
                    at: typeof p.at === 'number' ? p.at : Date.now(),
                });
            })
            .on('broadcast', { event: 'viewer_joined' }, ({ payload }) => {
                const name = (payload as { name?: unknown } | null)?.name;
                if (typeof name === 'string' && name.trim()) {
                    handlersRef.current.onViewerJoined?.(name.trim());
                }
            })
            .subscribe();
        return () => {
            void supabase.removeChannel(channel);
        };
    }, [streamId, active]);
}
