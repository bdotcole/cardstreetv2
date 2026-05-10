/**
 * Orders Checkout Route — Phase 1 (Synchronous)
 * 
 * Creates orders with status 'pending_payment' and reserves inventory.
 * This runs BEFORE the Stripe PaymentIntent is created.
 * 
 * Flow:
 *   1. Client calls POST /api/orders/checkout → orders created, listings reserved
 *   2. Client calls POST /api/checkout with transfer_group → Stripe charges card
 *   3. Stripe webhook fires payment_intent.succeeded → fulfillOrder() runs
 * 
 * This architecture prevents "zombie payments" where money is charged
 * but no order record exists.
 */

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { estimateRate } from '@/lib/flashExpress';

export async function POST(req: Request) {
    try {
        const { items, paymentMethod, buyerId } = await req.json();

        if (!items || !items.length || !buyerId) {
            return NextResponse.json({ error: 'Missing required fields (items, buyerId)' }, { status: 400 });
        }

        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        // ─── Generate transfer_group upfront ───
        // This is the key that links orders → PaymentIntent → webhook fulfillment
        const transferGroup = `order_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

        // ─── Fetch profiles ───
        const sellerIds = [...new Set(items.map((i: any) => i.sellerId))] as string[];
        const { data: sellerProfiles } = await supabase
            .from('profiles')
            .select('*')
            .in('id', sellerIds);

        const { data: buyerProfile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', buyerId)
            .single();

        // ─── Calculate platform fees per seller ───
        const feeMap = new Map<string, number>();
        if (sellerProfiles) {
            for (const profile of sellerProfiles) {
                let fee = 0.09; // Default 9%
                if (profile.role === 'partner') {
                    const level = String(profile.partner_level || 'standard').toLowerCase().replace(' ', '_');
                    switch (level) {
                        case 'bronze': fee = 0.05; break;
                        case 'silver': fee = 0.045; break;
                        case 'gold': fee = 0.04; break;
                        case 'platinum': fee = 0.035; break;
                        case 'sapphire': fee = 0.03; break;
                        case 'ruby': fee = 0.0275; break;
                        case 'emerald': fee = 0.025; break;
                        case 'diamond': fee = 0.0225; break;
                        case 'pink_diamond': fee = 0.02; break;
                        case 'heart': fee = 0.02; break;
                        default: fee = 0.05; break;
                    }
                }
                feeMap.set(profile.id, fee);
            }
        }

        // ─── Calculate shipping estimates per seller ───
        const FALLBACK_RATE_THB = 40;
        const sellerShippingMap = new Map<string, number>();

        for (const sellerId of sellerIds) {
            const sellerProfile = sellerProfiles?.find(p => p.id === sellerId);
            try {
                const quote = await estimateRate({
                    srcProvinceName: sellerProfile?.province || 'กรุงเทพมหานคร',
                    srcCityName: sellerProfile?.state || sellerProfile?.district || 'เขตบางรัก',
                    srcPostalCode: sellerProfile?.postcode || '10500',
                    dstProvinceName: buyerProfile?.province || 'กรุงเทพมหานคร',
                    dstCityName: buyerProfile?.state || buyerProfile?.district || 'เขตบางรัก',
                    dstPostalCode: buyerProfile?.postcode || '10110',
                    weight: 500,
                    width: 10,
                    length: 15,
                    height: 2,
                });
                sellerShippingMap.set(sellerId, (quote.estimatePrice + quote.upCountryAmount) / 100);
            } catch (err) {
                console.error(`[Orders/Checkout] Flash Express estimate error for seller ${sellerId}:`, err);
                sellerShippingMap.set(sellerId, FALLBACK_RATE_THB);
            }
        }

        // ─── Build order records ───
        const ordersToInsert: any[] = [];
        const listingIdsToUpdate: string[] = [];
        const shippingApplied = new Set<string>(); // Track which sellers already had shipping applied

        for (const item of items) {
            const feePercentage = feeMap.get(item.sellerId) || 0.09;

            // Apply shipping fee only once per seller
            let itemShippingFee = 0;
            if (!shippingApplied.has(item.sellerId)) {
                itemShippingFee = sellerShippingMap.get(item.sellerId) || FALLBACK_RATE_THB;
                shippingApplied.add(item.sellerId);
            }

            ordersToInsert.push({
                listing_id: item.id,
                buyer_id: buyerId,
                seller_id: item.sellerId,
                status: 'pending_payment', // ← Key change: not 'paid' yet
                total_amount: item.price,
                platform_fee: item.price * feePercentage,
                shipping_fee: itemShippingFee,
                escrow_status: 'held',
                payment_method: paymentMethod || 'credit_card',
                transfer_group: transferGroup,
            });
            listingIdsToUpdate.push(item.id);
        }

        // ─── Insert orders ───
        const { data: insertedOrders, error: insertError } = await supabase
            .from('orders')
            .insert(ordersToInsert)
            .select();

        if (insertError || !insertedOrders) {
            console.error('[Orders/Checkout] Failed to create orders:', insertError);
            throw new Error('Failed to create orders in database');
        }

        console.log(`[Orders/Checkout] Created ${insertedOrders.length} orders with transfer_group: ${transferGroup}`);

        // ─── Reserve listings (mark as sold to prevent double-selling) ───
        const { error: listingsUpdateError } = await supabase
            .from('listings')
            .update({ status: 'sold' })
            .in('id', listingIdsToUpdate);

        if (listingsUpdateError) {
            console.error('[Orders/Checkout] Failed to reserve listings:', listingsUpdateError);
            // Non-fatal but concerning
        }

        // ─── Transfer inventory to buyer ───
        const { data: buyerCollections } = await supabase
            .from('collections')
            .select('id')
            .eq('user_id', buyerId)
            .limit(1);

        let targetCollectionId: string;
        if (!buyerCollections || buyerCollections.length === 0) {
            const { data: newCollection } = await supabase
                .from('collections')
                .insert({ user_id: buyerId, name: 'Main Vault', include_in_portfolio: true })
                .select()
                .single();
            targetCollectionId = newCollection!.id;
        } else {
            targetCollectionId = buyerCollections[0].id;
        }

        for (const item of items) {
            await supabase.from('collection_items').insert({
                collection_id: targetCollectionId,
                card_id: item.cardId,
                card_data: item.card,
                quantity: 1,
                condition: item.condition,
                purchase_price: item.price,
            });

            const { data: sellerItems } = await supabase
                .from('collection_items')
                .select('id, collections!inner(user_id)')
                .eq('card_id', item.cardId)
                .eq('collections.user_id', item.sellerId)
                .limit(1);

            if (sellerItems && sellerItems.length > 0) {
                await supabase.from('collection_items').delete().eq('id', sellerItems[0].id);
            }
        }

        // ─── Calculate total for the client ───
        const totalAmount = items.reduce((sum: number, i: any) => sum + i.price, 0)
            + insertedOrders.reduce((sum: number, o: any) => sum + (o.shipping_fee || 0), 0);

        return NextResponse.json({
            success: true,
            transferGroup,
            orderIds: insertedOrders.map(o => o.id),
            totalAmount,
            message: 'Orders created with pending_payment status. Proceed to payment.',
        });

    } catch (err: any) {
        console.error('[Orders/Checkout] Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
