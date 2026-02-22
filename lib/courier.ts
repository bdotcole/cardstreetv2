import CourierClient from "@trycourier/courier";
import { createClient } from "@supabase/supabase-js";

// Initialize Courier client
const courier = new CourierClient({
    apiKey: process.env.COURIER_AUTH_TOKEN || "mock_token"
});

// Initialize Supabase admin client for fetching user details/preferences
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Helper to fetch a user's notification preferences.
 */
async function getNotificationPreferences(userId: string) {
    const { data: prefs, error } = await supabaseAdmin
        .from('notification_preferences')
        .select('*')
        .eq('user_id', userId)
        .single();

    if (error || !prefs) {
        // Default to all true if not found/error
        return {
            sold_email: true,
            sold_push: true,
            label_email: true,
            label_push: true,
            shipped_email: true,
            shipped_push: true
        };
    }
    return prefs;
}

/**
 * Helper to get a user's email address from auth table.
 */
async function getUserEmail(userId: string): Promise<string | null> {
    const { data: { user }, error } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (error || !user) return null;
    return user.email || null;
}


/**
 * Notifies the seller when their item is sold.
 */
export async function sendSoldNotification(sellerId: string, orderDetails: any) {
    const prefs = await getNotificationPreferences(sellerId);
    if (!prefs.sold_email && !prefs.sold_push) return;

    const email = await getUserEmail(sellerId);
    if (!email) return;

    try {
        await courier.send.message({
            message: {
                to: {
                    email: email,
                    // If FCM push tokens were stored, they'd be added here if prefs.sold_push is true.
                    // e.g., firebaseToken: pushToken
                },
                content: {
                    title: "CardStreet: You have a new sale!",
                    body: `Great news! Your item has been sold for ฿${orderDetails.total_amount}. Please check your orders dashboard to arrange shipping.`,
                },
                routing: {
                    method: "all",
                    channels: [
                        ...(prefs.sold_email ? ["email"] : []),
                        ...(prefs.sold_push ? ["push"] : [])
                    ]
                }
            }
        });
        console.log(`[Courier] 'Sold' notification sent to seller ${sellerId}`);
    } catch (error) {
        console.error(`[Courier] Error sending 'Sold' notification:`, error);
    }
}

/**
 * Notifies the seller that a shipping label is ready.
 */
export async function sendLabelGeneratedNotification(sellerId: string, orderDetails: any, labelUrl: string) {
    const prefs = await getNotificationPreferences(sellerId);
    if (!prefs.label_email && !prefs.label_push) return;

    const email = await getUserEmail(sellerId);
    if (!email) return;

    try {
        await courier.send.message({
            message: {
                to: { email: email },
                content: {
                    title: "CardStreet: Shipping Label Generated",
                    body: `Your shipping label for order ${orderDetails.id} is ready. You can print it here: ${labelUrl}`,
                },
                routing: {
                    method: "all",
                    channels: [
                        ...(prefs.label_email ? ["email"] : []),
                        ...(prefs.label_push ? ["push"] : [])
                    ]
                }
            }
        });
        console.log(`[Courier] 'Label Generated' notification sent to seller ${sellerId}`);
    } catch (error) {
        console.error(`[Courier] Error sending 'Label Generated' notification:`, error);
    }
}

/**
 * Notifies the buyer that their item has shipped.
 */
export async function sendShippedNotification(buyerId: string, orderDetails: any, trackingUrl: string) {
    const prefs = await getNotificationPreferences(buyerId);
    if (!prefs.shipped_email && !prefs.shipped_push) return;

    const email = await getUserEmail(buyerId);
    if (!email) return;

    try {
        await courier.send.message({
            message: {
                to: { email: email },
                content: {
                    title: "CardStreet: Order Shipped!",
                    body: `Your order ${orderDetails.id} is on the way! Track it here: ${trackingUrl}`,
                },
                routing: {
                    method: "all",
                    channels: [
                        ...(prefs.shipped_email ? ["email"] : []),
                        ...(prefs.shipped_push ? ["push"] : [])
                    ]
                }
            }
        });
        console.log(`[Courier] 'Shipped' notification sent to buyer ${buyerId}`);
    } catch (error) {
        console.error(`[Courier] Error sending 'Shipped' notification:`, error);
    }
}
