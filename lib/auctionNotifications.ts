/**
 * Auction notifications (beta) -- inline-content Courier sends.
 *
 * Deliberately NOT dashboard templates: the auction house is dark-shipped and
 * the copy will churn during beta. Inline content delivers as an
 * auto-generated email + FCM push (the release-funds pattern); promote to
 * designed templates when the feature goes public (see lib/courier.ts for the
 * template discipline -- template ids come from each template's own Send tab).
 *
 * Every send is best-effort and never throws: a notification failure must not
 * fail a bid, a settlement, or the sweep.
 */

import CourierClient from '@trycourier/courier';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _courier: InstanceType<typeof CourierClient> | null | undefined;
function getCourier() {
    if (_courier !== undefined) return _courier;
    const token = (process.env.COURIER_AUTH_TOKEN || '').trim();
    _courier = token ? new CourierClient({ apiKey: token }) : null;
    if (!_courier) console.warn('[AuctionNotify] COURIER_AUTH_TOKEN not set — auction notifications skipped.');
    return _courier;
}

let _admin: SupabaseClient | null = null;
function getAdmin(): SupabaseClient {
    if (_admin) return _admin;
    _admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    return _admin;
}

async function sendInline(
    userId: string,
    title: string,
    body: string,
    data: Record<string, unknown>,
): Promise<void> {
    try {
        const courier = getCourier();
        if (!courier) return;

        const supabase = getAdmin();
        const { data: { user } } = await supabase.auth.admin.getUserById(userId);
        const email = user?.email || null;
        const { data: prefs } = await supabase
            .from('notification_preferences')
            .select('fcm_token')
            .eq('user_id', userId)
            .maybeSingle();
        const fcmToken = prefs?.fcm_token || null;

        if (!email && !fcmToken) return;

        const recipient: Record<string, string> = {};
        const channels: string[] = [];
        if (email) { recipient.email = email; channels.push('email'); }
        if (fcmToken) { recipient.firebaseToken = fcmToken; channels.push('push'); }

        await courier.send.message({
            message: {
                to: recipient,
                content: { title, body },
                routing: { method: 'all', channels },
                data,
            },
        });
    } catch (err) {
        console.error(`[AuctionNotify] send failed for ${userId}:`, err);
    }
}

const thb = (satang: number) => `฿${(satang / 100).toLocaleString()}`;

function cardName(cardData: unknown): string {
    const name = (cardData as { name?: unknown } | null)?.name;
    return typeof name === 'string' && name ? name : 'your card';
}

export async function notifyAuctionWon(
    winnerId: string,
    auction: { id: string; card_data: unknown; winning_amount: number },
    totalThb: number,
    paymentDueAt: string,
): Promise<void> {
    await sendInline(
        winnerId,
        'CardStreet: You won the auction! 🏆',
        `You won ${cardName(auction.card_data)} for ${thb(auction.winning_amount)}. ` +
        `Total with shipping: ฿${totalThb.toLocaleString()}. Pay within 24 hours to secure it.`,
        { auctionId: auction.id, type: 'auction_won', paymentDueAt },
    );
}

export async function notifyAuctionSoldSeller(
    sellerId: string,
    auction: { id: string; card_data: unknown; winning_amount: number },
): Promise<void> {
    await sendInline(
        sellerId,
        'CardStreet: Your auction sold! 🎉',
        `${cardName(auction.card_data)} sold at auction for ${thb(auction.winning_amount)}. ` +
        `The buyer has 24 hours to pay — we'll notify you when payment lands.`,
        { auctionId: auction.id, type: 'auction_sold' },
    );
}

export async function notifyAuctionUnsold(
    sellerId: string,
    auction: { id: string; card_data: unknown },
    reason: 'no_bids' | 'reserve_not_met' | 'deadbeat' | 'offer_lapsed',
): Promise<void> {
    const why = reason === 'reserve_not_met'
        ? 'the reserve price was not met'
        : reason === 'deadbeat'
            ? 'the winner did not pay in time'
            : reason === 'offer_lapsed'
                ? 'the second-chance offer lapsed'
                : 'it received no bids';
    await sendInline(
        sellerId,
        'CardStreet: Your auction ended',
        `Your auction for ${cardName(auction.card_data)} ended without a sale — ${why}. You can relist it anytime.`,
        { auctionId: auction.id, type: 'auction_unsold', reason },
    );
}

export async function notifyOutbid(
    bidderId: string,
    auction: { id: string; card_data: unknown; current_price: number },
): Promise<void> {
    await sendInline(
        bidderId,
        'CardStreet: You\'ve been outbid',
        `Someone outbid you on ${cardName(auction.card_data)}. ` +
        `Current price: ${thb(auction.current_price)}. Raise your max bid to stay in it.`,
        { auctionId: auction.id, type: 'auction_outbid' },
    );
}

export async function notifyStrike(
    userId: string,
    auction: { id: string; card_data: unknown },
): Promise<void> {
    await sendInline(
        userId,
        'CardStreet: Unpaid auction recorded',
        `Your winning bid on ${cardName(auction.card_data)} was cancelled because payment wasn't completed in time. ` +
        `Two unpaid auctions within 90 days suspends bidding.`,
        { auctionId: auction.id, type: 'auction_strike' },
    );
}

export async function notifySecondChanceOffer(
    userId: string,
    auction: { id: string; card_data: unknown; second_chance_amount: number | null; second_chance_expires_at: string | null },
): Promise<void> {
    await sendInline(
        userId,
        'CardStreet: Second-chance offer 🎯',
        `The winner didn't complete payment, so ${cardName(auction.card_data)} can be yours at your max bid of ` +
        `${thb(auction.second_chance_amount ?? 0)}. Accept in the app within 48 hours.`,
        { auctionId: auction.id, type: 'auction_second_chance' },
    );
}
